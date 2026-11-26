# Runs inside a real Spree app (infra/spree Docker store):
#   docker compose -f infra/spree/docker-compose.yml exec spree42 bin/rails runner /gems/spree_admin_native/test/integration_test.rb
# Each test runs in a transaction that is rolled back, so the store's data is unchanged.
require 'minitest/autorun'
require 'rack/test'
require 'socket'
require 'json'

class SpreeAdminNativeIntegrationTest < Minitest::Test
  include Rack::Test::Methods

  def app
    Rails.application
  end

  def setup
    host! 'localhost'
    @admin = Spree.user_class.joins(:spree_roles).where(spree_roles: { name: 'admin' }).first
    raise 'seed an admin first' unless @admin
  end

  def run(*)
    result = nil
    ActiveRecord::Base.transaction do
      result = super
      raise ActiveRecord::Rollback
    end
    result
  end

  def host!(host)
    header 'Host', host
  end

  def json
    JSON.parse(last_response.body)
  end

  def pair!(name = 'Test iPhone')
    _pairing, code = SpreeAdminNative::Pairing.start!(owner: @admin)
    post '/api/admin_native/v1/pairings/exchange', { code: code, device_name: name, platform: 'ios' }.to_json, 'CONTENT_TYPE' => 'application/json'
    assert_equal 201, last_response.status, last_response.body
    json['token']
  end

  def test_capabilities_are_public_and_describe_the_store
    get '/api/admin_native/v1/capabilities'
    assert_equal 200, last_response.status
    assert_includes json['api_families'], 'api-v1'
    assert_includes json['capabilities'], 'notifications.push'
    assert_includes json['auth_methods'], 'pairing'
    assert_equal SpreeAdminNative::VERSION, json['gem_version']
  end

  def test_pairing_code_is_single_use_and_accepts_dashes_and_lowercase
    _pairing, code = SpreeAdminNative::Pairing.start!(owner: @admin)
    typed = code.downcase.scan(/.{1,4}/).join('-')
    post '/api/admin_native/v1/pairings/exchange', { code: typed, device_name: 'iPad' }.to_json, 'CONTENT_TYPE' => 'application/json'
    assert_equal 201, last_response.status
    assert json['token'].start_with?('san_')
    assert_equal @admin.email, json.dig('user', 'email')

    post '/api/admin_native/v1/pairings/exchange', { code: code, device_name: 'Again' }.to_json, 'CONTENT_TYPE' => 'application/json'
    assert_equal 422, last_response.status
    assert_equal 'invalid_code', json.dig('error', 'code')
  end

  def test_expired_codes_are_refused
    pairing, code = SpreeAdminNative::Pairing.start!(owner: @admin)
    pairing.update_column(:expires_at, 1.minute.ago)
    post '/api/admin_native/v1/pairings/exchange', { code: code, device_name: 'Late' }.to_json, 'CONTENT_TYPE' => 'application/json'
    assert_equal 422, last_response.status
  end

  def test_device_token_works_on_api_v1_until_revoked
    token = pair!
    header 'X-Spree-Token', token
    get '/api/v1/orders', per_page: 1
    assert_equal 200, last_response.status, last_response.body

    device = SpreeAdminNative::Device.find_by(token_digest: SpreeAdminNative::Tokens.digest(token))
    refute_nil device.last_used_at
    device.revoke!
    get '/api/v1/orders', per_page: 1
    assert_equal 401, last_response.status
  end

  # dna-admin locks accounts (account_locked?); a locked admin's paired devices must stop working.
  def test_locked_accounts_lose_device_access
    token = pair!
    header 'X-Spree-Token', token
    get '/api/v1/orders', per_page: 1
    assert_equal 200, last_response.status

    Spree.user_class.class_eval { def account_locked?; true; end }
    get '/api/v1/orders', per_page: 1
    assert_equal 401, last_response.status
    get '/api/admin_native/v1/summary'
    assert_equal 401, last_response.status
  ensure
    Spree.user_class.class_eval { remove_method :account_locked? if method_defined?(:account_locked?, false) }
  end

  def test_tokens_are_stored_only_as_digests
    token = pair!
    refute SpreeAdminNative::Device.where(token_digest: token).exists?
    assert SpreeAdminNative::Device.where(token_digest: SpreeAdminNative::Tokens.digest(token)).exists?
  end

  def test_summary_needs_an_admin_and_counts_orders
    get '/api/admin_native/v1/summary'
    assert_equal 401, last_response.status

    header 'X-Spree-Token', pair!
    get '/api/admin_native/v1/summary'
    assert_equal 200, last_response.status
    expected = Spree::Order.complete.where(state: 'complete', shipment_state: %w[pending ready partial backorder]).count
    assert_equal expected, json['orders_to_fulfill']
    assert_operator json['low_stock_variants'], :>=, 1
    assert_match(/\A\d+\.\d{2}\z/, json.dig('today', 'sales'))
  end

  def test_admin_api_key_also_works_for_the_summary
    @admin.generate_spree_api_key! if @admin.spree_api_key.blank?
    header 'X-Spree-Token', @admin.spree_api_key
    get '/api/admin_native/v1/summary'
    assert_equal 200, last_response.status
  end

  def test_registering_a_push_token_and_revoking_a_device
    token = pair!
    header 'X-Spree-Token', token
    patch '/api/admin_native/v1/devices/current', { push_token: 'ExponentPushToken[abc123]' }.to_json, 'CONTENT_TYPE' => 'application/json'
    assert_equal 200, last_response.status
    assert json['has_push_token']

    get '/api/admin_native/v1/devices'
    id = json['data'].first['id']
    delete "/api/admin_native/v1/devices/#{id}"
    assert_equal 204, last_response.status
    get '/api/admin_native/v1/devices'
    assert_equal 401, last_response.status
  end

  def test_completing_an_order_triggers_the_hook_once
    order = Spree::Order.complete.first
    order.update_column(:completed_at, nil)
    order.reload.update!(completed_at: Time.current)
    assert order.send(:admin_native_just_completed?)
    order.update!(special_instructions: 'leave at door')
    refute order.send(:admin_native_just_completed?)
  end

  def test_new_order_push_reaches_expo_and_forgets_dead_tokens
    received = []
    server = TCPServer.new('127.0.0.1', 0)
    thread = Thread.new do
      client = server.accept
      length = 0
      while (line = client.gets) && line != "\r\n"
        length = line.split(':', 2).last.to_i if line.downcase.start_with?('content-length')
      end
      received << JSON.parse(client.read(length))
      body = { data: [{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }.to_json
      client.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}")
      client.close
    end
    previous = SpreeAdminNative.config.expo_push_url
    SpreeAdminNative.config.expo_push_url = "http://127.0.0.1:#{server.addr[1]}/push"

    SpreeAdminNative::Device.update_all(push_token: nil)
    live, = SpreeAdminNative::Device.issue!(owner: @admin, name: 'Live')
    dead, = SpreeAdminNative::Device.issue!(owner: @admin, name: 'Dead')
    live.update!(push_token: 'ExponentPushToken[live]')
    dead.update!(push_token: 'ExponentPushToken[dead]')

    order = Spree::Order.complete.first
    SpreeAdminNative::PushJob.perform_now('order.completed', order.id)
    thread.join(5)

    messages = received.first
    assert_equal 2, messages.size
    assert_equal "New order #{order.number}", messages.first['title']
    assert_includes messages.first['body'], order.display_total.to_s
    assert_equal order.number, messages.first.dig('data', 'orderNumber')
    assert_nil dead.reload.push_token
    refute_nil live.reload.push_token
  ensure
    SpreeAdminNative.config.expo_push_url = previous
    server&.close
  end
end
