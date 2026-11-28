# Runs inside a real Spree app (infra/spree Docker store):
#   docker compose -f infra/spree/docker-compose.yml exec spree42 bin/rails runner /gems/spree_admin_native/test/integration_test.rb
# Each test runs in a transaction that is rolled back, so the store's data is unchanged.
require 'minitest/autorun'
require 'rack/test'
require 'socket'
require 'json'
require 'active_support/testing/time_helpers'

class SpreeAdminNativeIntegrationTest < Minitest::Test
  include Rack::Test::Methods
  include Warden::Test::Helpers

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
    %w[orders.refund promotions.read promotions.write inventory.lowStock media.library].each { |c| assert_includes json['capabilities'], c }
    %w[orders.refund orders.create promotions.read promotions.write inventory.lowStock].each { |c| assert_includes json['capabilities'], c }
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

  # --- 0.2: refunds -----------------------------------------------------------------------

  def refundable_payment
    Spree::Payment.where(state: 'completed').detect { |p| p.credit_allowed >= 2 } || raise('seed a paid order first')
  end

  def json_post(path, body)
    post path, body.to_json, 'CONTENT_TYPE' => 'application/json'
  end

  def test_refund_reasons_need_an_admin
    get '/api/admin_native/v1/refund_reasons'
    assert_equal 401, last_response.status
    header 'X-Spree-Token', pair!
    get '/api/admin_native/v1/refund_reasons'
    assert_equal 200, last_response.status
    assert(json['data'].any? { |r| r['name'] == 'Return processing' })
  end

  def test_partial_refund_credits_the_payment_and_updates_the_order
    payment = refundable_payment
    before = payment.credit_allowed
    header 'X-Spree-Token', pair!
    json_post "/api/admin_native/v1/orders/#{payment.order.number}/payments/#{payment.number}/refunds", amount: '1.00'
    assert_equal 201, last_response.status, last_response.body
    assert_equal '1.0', json.dig('refund', 'amount')
    assert_equal payment.number, json.dig('refund', 'payment_number')
    assert_equal 'Return processing', json.dig('refund', 'reason')
    assert_equal before - 1, payment.reload.credit_allowed
    assert_equal payment.order.reload.payment_state, json.dig('order', 'payment_state')
  end

  def test_refund_over_the_paid_amount_is_refused
    payment = refundable_payment
    refunds_before = payment.refunds.count
    header 'X-Spree-Token', pair!
    json_post "/api/admin_native/v1/orders/#{payment.order.number}/payments/#{payment.number}/refunds",
              amount: (payment.credit_allowed + 1).to_s
    assert_equal 422, last_response.status
    assert_equal 'invalid', json.dig('error', 'code')
    assert_equal refunds_before, payment.refunds.count
  end

  def test_refund_needs_an_amount_and_a_known_payment
    payment = refundable_payment
    header 'X-Spree-Token', pair!
    json_post "/api/admin_native/v1/orders/#{payment.order.number}/payments/#{payment.number}/refunds", {}
    assert_equal 422, last_response.status
    json_post "/api/admin_native/v1/orders/#{payment.order.number}/payments/NOPE/refunds", amount: '1'
    assert_equal 404, last_response.status
  end

  def test_refund_uses_a_chosen_reason
    payment = refundable_payment
    reason = Spree::RefundReason.create!(name: 'Damaged in transit')
    header 'X-Spree-Token', pair!
    json_post "/api/admin_native/v1/orders/#{payment.order.number}/payments/#{payment.number}/refunds",
              amount: '1', reason_id: reason.id.to_s
    assert_equal 201, last_response.status, last_response.body
    assert_equal 'Damaged in transit', json.dig('refund', 'reason')
  end

  # --- 0.2: promotions --------------------------------------------------------------------

  def test_promotions_need_an_admin
    get '/api/admin_native/v1/promotions'
    assert_equal 401, last_response.status
  end

  def test_create_a_percent_coupon_then_list_and_find_it
    header 'X-Spree-Token', pair!
    json_post '/api/admin_native/v1/promotions',
              name: 'Spring sale', code: 'SPRING20', discount: { type: 'percent', amount: '20' }
    assert_equal 201, last_response.status, last_response.body
    created = json['data']
    assert_equal 'SPRING20', created['code']
    assert_equal 'active', created['status']
    assert_equal({ 'type' => 'percent', 'amount' => '20.0' }, created['discount'])
    assert created['editable_discount']
    assert Spree::Promotion.with_coupon_code('spring20')

    get '/api/admin_native/v1/promotions', q: 'spring', per_page: 5
    assert_equal 200, last_response.status
    assert_equal [created['id']], json['data'].map { |p| p['id'] } & [created['id']]
    assert json.dig('meta', 'total_count') >= 1

    get "/api/admin_native/v1/promotions/#{created['id']}"
    assert_equal 'Spring sale', json.dig('data', 'name')
  end

  def test_update_switches_to_a_fixed_discount_and_expires
    header 'X-Spree-Token', pair!
    json_post '/api/admin_native/v1/promotions', name: 'Ten off', code: 'TENOFF', discount: { type: 'percent', amount: '10' }
    id = json.dig('data', 'id')
    patch "/api/admin_native/v1/promotions/#{id}",
          { discount: { type: 'fixed', amount: '5' }, expires_at: 1.minute.ago.iso8601 }.to_json,
          'CONTENT_TYPE' => 'application/json'
    assert_equal 200, last_response.status, last_response.body
    assert_equal 'fixed', json.dig('data', 'discount', 'type')
    assert_equal '5.0', json.dig('data', 'discount', 'amount')
    assert_equal 'expired', json.dig('data', 'status')
    assert_equal 1, Spree::Promotion.find(id).promotion_actions.count

    get '/api/admin_native/v1/promotions', status: 'expired'
    assert_includes json['data'].map { |p| p['id'] }, id
    get '/api/admin_native/v1/promotions', status: 'active'
    refute_includes json['data'].map { |p| p['id'] }, id
  end

  def test_invalid_promotions_are_refused_without_saving
    header 'X-Spree-Token', pair!
    count = Spree::Promotion.count
    json_post '/api/admin_native/v1/promotions', name: 'Bad', code: 'BAD', discount: { type: 'percent', amount: '150' }
    assert_equal 422, last_response.status
    json_post '/api/admin_native/v1/promotions', name: 'Bad', code: 'BAD', discount: { type: 'bogo', amount: '1' }
    assert_equal 422, last_response.status
    json_post '/api/admin_native/v1/promotions', name: '', code: 'BAD', discount: { type: 'fixed', amount: '1' }
    assert_equal 422, last_response.status
    assert_equal count, Spree::Promotion.count
  end

  def test_promotions_with_other_actions_keep_their_discount
    promotion = Spree::Promotion.create!(name: 'Free shipping')
    Spree::Promotion::Actions::FreeShipping.create!(promotion: promotion)
    header 'X-Spree-Token', pair!
    get "/api/admin_native/v1/promotions/#{promotion.id}"
    refute json.dig('data', 'editable_discount')
    patch "/api/admin_native/v1/promotions/#{promotion.id}", { discount: { type: 'fixed', amount: '5' } }.to_json,
          'CONTENT_TYPE' => 'application/json'
    assert_equal 422, last_response.status
    patch "/api/admin_native/v1/promotions/#{promotion.id}", { name: 'Free shipping weekend' }.to_json,
          'CONTENT_TYPE' => 'application/json'
    assert_equal 200, last_response.status
    assert_equal 'Free shipping weekend', json.dig('data', 'name')
  end

  # --- 0.3: low stock ---------------------------------------------------------------------

  def make_product(name, stock, options: false, track: true, discontinued: false)
    product = Spree::Product.create!(name: name, price: 10, shipping_category: Spree::ShippingCategory.first,
                                     available_on: 1.day.ago)
    product.update_column(:discontinue_on, 1.day.ago) if discontinued
    location = Spree::StockLocation.first
    variants = if options
                 option_type = Spree::OptionType.first || Spree::OptionType.create!(name: 'size', presentation: 'Size')
                 product.option_types << option_type unless product.option_types.include?(option_type)
                 stock.each_with_index.map do |_, i|
                   value = option_type.option_values.create!(name: "#{name}-#{i}", presentation: "#{name} #{i}")
                   product.variants.create!(option_values: [value], price: 10, track_inventory: track)
                 end
               else
                 product.master.update!(track_inventory: track)
                 [product.master]
               end
    variants.zip(stock).each { |v, n| location.stock_item_or_create(v).update_columns(count_on_hand: n) }
    product.master.stock_items.update_all(count_on_hand: 0) if options
    [product, variants]
  end

  def low_stock_ids
    get '/api/admin_native/v1/low_stock', per_page: 100
    assert_equal 200, last_response.status, last_response.body
    json['data'].map { |r| r['product_id'] }
  end

  def test_low_stock_lists_sellable_tracked_variants_of_live_products
    low, = make_product('LS low', [1])
    fine, = make_product('LS fine', [50])
    with_options, = make_product('LS sizes', [0, 30], options: true)
    untracked, = make_product('LS untracked', [0], track: false)
    retired, = make_product('LS retired', [0], discontinued: true)
    header 'X-Spree-Token', pair!
    ids = low_stock_ids
    assert_includes ids, low.id.to_s
    assert_includes ids, with_options.id.to_s
    [fine, untracked, retired].each { |p| refute_includes ids, p.id.to_s }
    row = json['data'].find { |r| r['product_id'] == with_options.id.to_s }
    assert_equal 1, row['low_variants'], 'the master of a product with options is not counted'
    assert_equal 2, json.dig('meta', 'threshold')
  end

  def test_low_stock_sums_stock_across_locations
    product, variants = make_product('LS two places', [1])
    variant = variants.first
    second = Spree::StockLocation.create!(name: 'Second warehouse', country: Spree::Country.first)
    second.stock_item_or_create(variant).update_columns(count_on_hand: 10)
    header 'X-Spree-Token', pair!
    refute_includes low_stock_ids, product.id.to_s
  end

  def test_summary_counts_the_same_variants_the_list_shows
    make_product('LS a', [0])
    make_product('LS b', [1, 2], options: true)
    header 'X-Spree-Token', pair!
    get '/api/admin_native/v1/summary'
    count = json['low_stock_variants']
    get '/api/admin_native/v1/low_stock', per_page: 100
    assert_equal count, json['data'].sum { |r| r['low_variants'] }
    assert_operator count, :>=, 3
  end

  def test_low_stock_needs_an_admin
    get '/api/admin_native/v1/low_stock'
    assert_equal 401, last_response.status
  end

  # --- 0.3: media library -----------------------------------------------------------------

  # A 2x2 PNG, so Spree's content-type check accepts the attachment.
  def png
    chunk = ->(type, data) { [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N') }
    raw = ("\x00".b + "\x0a\x14\x1e".b * 2) * 2
    "\x89PNG\r\n\x1a\n".b + chunk.call('IHDR'.b, [2, 2, 8, 2, 0, 0, 0].pack('NNCCCCC')) +
      chunk.call('IDAT'.b, Zlib::Deflate.deflate(raw)) + chunk.call('IEND'.b, ''.b)
  end

  def add_image(variant, alt: nil, at: Time.current)
    image = Spree::Image.new(viewable: variant, alt: alt)
    image.attachment.attach(io: StringIO.new(png), filename: 'test.png', content_type: 'image/png')
    image.save!
    image.update_column(:created_at, at)
    image
  end

  def media(params = {})
    get '/api/admin_native/v1/media', { per_page: 100 }.merge(params)
    assert_equal 200, last_response.status, last_response.body
    json
  end

  def test_media_needs_an_admin
    get '/api/admin_native/v1/media'
    assert_equal 401, last_response.status
  end

  def test_media_lists_product_and_variant_images_newest_first_with_urls
    product, variants = make_product('ML zebra lamp', [5, 5], options: true)
    on_master = add_image(product.master, alt: 'Front', at: 2.minutes.ago)
    on_variant = add_image(variants.first, at: 1.minute.ago)
    header 'X-Spree-Token', pair!
    body = media(q: 'Zebra Lamp')
    assert_equal [on_variant.id.to_s, on_master.id.to_s], body['data'].map { |r| r['id'] }
    assert_equal 2, body.dig('meta', 'total_count')
    variant_row, master_row = body['data']
    assert_equal product.id.to_s, master_row['product_id']
    assert_equal 'ML zebra lamp', master_row['product_name']
    assert_nil master_row['variant_id'], 'master images show for every variant'
    assert_equal 'Front', master_row['alt']
    assert_equal 1, master_row['position']
    assert_equal variants.first.id.to_s, variant_row['variant_id']
    assert_nil variant_row['alt']
    %w[mini_url product_url large_url].each do |key|
      assert master_row[key].start_with?('http://localhost/rails/active_storage/representations/'), master_row[key]
    end
  end

  def test_media_searches_by_sku_and_filters_missing_alt
    product, = make_product('ML quokka mug', [5])
    product.master.update!(sku: 'QUOKKA-MUG-1')
    described = add_image(product.master, alt: 'A mug', at: 2.minutes.ago)
    blank = add_image(product.master, alt: '  ', at: 1.minute.ago)
    header 'X-Spree-Token', pair!
    assert_equal [blank.id.to_s, described.id.to_s], media(q: 'quokka-mug')['data'].map { |r| r['id'] }
    assert_equal [blank.id.to_s], media(q: 'QUOKKA', missing_alt: 'true')['data'].map { |r| r['id'] }
    assert_nil json['data'].first['alt'], 'blank alt text reads as none'
  end

  def test_media_leaves_out_deleted_products_and_pages
    product, = make_product('ML okapi rug', [5])
    3.times { |i| add_image(product.master, at: (i + 1).minutes.ago) }
    gone, = make_product('ML okapi gone', [5])
    add_image(gone.master)
    gone.destroy
    header 'X-Spree-Token', pair!
    first = media(q: 'okapi', per_page: 2, page: 1)
    assert_equal 3, first.dig('meta', 'total_count')
    assert_equal 2, first['data'].size
    second = media(q: 'okapi', per_page: 2, page: 2)
    assert_equal 1, second['data'].size
    assert_equal [product.id.to_s], (first['data'] + second['data']).map { |r| r['product_id'] }.uniq
  end

  # --- 0.3: order creation on API v1 ------------------------------------------------------

  def staff_draft(created_by: @admin)
    order = Spree::Order.create!(email: 'draft@example.com', store: Spree::Store.default, created_by: created_by)
    variant = Spree::Variant.where(is_master: false).first
    Spree::Cart::AddItem.call(order: order, variant: variant, quantity: 1)
    order
  end

  def test_payment_methods_are_the_ones_without_a_card
    get '/api/admin_native/v1/payment_methods'
    assert_equal 401, last_response.status

    store = { stores: [Spree::Store.default] }
    cash = Spree::PaymentMethod::Check.create!(name: 'Cash (back office)', display_on: 'back_end', active: true, **store)
    online = Spree::PaymentMethod::Check.create!(name: 'Pay later (storefront)', display_on: 'front_end', active: true, **store)
    off = Spree::PaymentMethod::Check.create!(name: 'Old check', display_on: 'both', active: false, **store)
    elsewhere = Spree::PaymentMethod::Check.create!(name: 'Other shop cash', display_on: 'both', active: true)
    header 'X-Spree-Token', pair!
    get '/api/admin_native/v1/payment_methods'
    assert_equal 200, last_response.status, last_response.body
    names = json['data'].map { |m| m['name'] }
    assert_includes names, 'Check'
    assert_includes names, cash.name
    [online.name, off.name, elsewhere.name, 'Credit Card', 'Store Credit'].each { |n| refute_includes names, n }
    assert_equal cash.id.to_s, json['data'].find { |m| m['name'] == cash.name }['id']
  end

  def test_a_staff_draft_can_be_deleted
    order = staff_draft
    header 'X-Spree-Token', pair!
    delete "/api/admin_native/v1/orders/#{order.number}"
    assert_equal 204, last_response.status, last_response.body
    refute Spree::Order.exists?(order.id)
    assert_equal 0, Spree::LineItem.where(order_id: order.id).count
  end

  def test_placed_orders_and_shopper_carts_are_not_deleted
    header 'X-Spree-Token', pair!
    placed = Spree::Order.complete.first
    delete "/api/admin_native/v1/orders/#{placed.number}"
    assert_equal 422, last_response.status
    assert_equal 'order_placed', json.dig('error', 'code')

    shopper = Spree.user_class.where.not(id: @admin.id).detect { |u| !u.has_spree_role?(:admin) }
    cart = staff_draft(created_by: shopper)
    delete "/api/admin_native/v1/orders/#{cart.number}"
    assert_equal 422, last_response.status
    assert_equal 'not_a_draft', json.dig('error', 'code')
    assert Spree::Order.exists?(cart.id)

    delete '/api/admin_native/v1/orders/R000NOPE'
    assert_equal 404, last_response.status
  end

  def test_deleting_drafts_needs_an_admin
    order = staff_draft
    delete "/api/admin_native/v1/orders/#{order.number}"
    assert_equal 401, last_response.status
    assert Spree::Order.exists?(order.id)
  end

  # --- 0.4: host-described admin types ----------------------------------------------------

  def with_resources
    registry = SpreeAdminNative.resources
    registry.register('t_refund_reasons') do |r|
      r.model 'Spree::RefundReason'
      r.label 'Refund reasons'
      r.group 'Payments'
      r.title :name
      r.search :name
      r.filter :active
      r.fields :auto
      r.action :retire, label: 'Retire', confirm: 'Stop offering this reason?', if: ->(reason) { reason.active } do |reason, _admin|
        reason.update!(active: false)
        'Retired.'
      end
    end
    registry.register('t_countries') do |r|
      r.model 'Spree::Country'
      r.title :name
      r.fields :auto
      r.actions create: false, update: false, destroy: false
    end
    registry.register('t_states') do |r|
      r.model 'Spree::State'
      r.fields :auto
      r.field :country_id, :reference, resource: 't_countries', label: 'Country'
    end
    registry.register('t_users') do |r|
      r.model Spree.user_class.name
      r.fields :auto
    end
    registry.register('t_missing') { |r| r.model 'NoSuchModelAnywhere' }
    yield
  ensure
    %w[t_refund_reasons t_countries t_states t_users t_missing].each { |k| registry.unregister(k) }
  end

  def resource_json(method, path, body = nil)
    send(method, "/api/admin_native/v1/resources#{path}", body&.to_json, 'CONTENT_TYPE' => 'application/json')
    last_response.body.empty? ? {} : json
  end

  def test_manifest_lists_available_types_only_and_hides_secrets
    with_resources do
      header 'X-Spree-Token', pair!
      get '/api/admin_native/v1/capabilities'
      assert_includes json['capabilities'], 'admin.resources'
      data = resource_json(:get, '')['data']
      keys = data.map { |d| d['key'] }
      assert_includes keys, 't_refund_reasons'
      refute_includes keys, 't_missing'
      reasons = data.find { |d| d['key'] == 't_refund_reasons' }
      assert_equal 'Payments', reasons['group']
      assert_equal 'name', reasons['title_field']
      assert_equal [{ 'name' => 'retire', 'label' => 'Retire', 'confirm' => 'Stop offering this reason?', 'destructive' => false }], reasons['actions']
      assert_includes reasons['fields'].map { |f| f['name'] }, 'active'
      assert_equal 'boolean', reasons['fields'].find { |f| f['name'] == 'active' }['type']
      user_fields = data.find { |d| d['key'] == 't_users' }['fields'].map { |f| f['name'] }
      assert_includes user_fields, 'email'
      %w[encrypted_password password_salt spree_api_key reset_password_token].each { |secret| refute_includes user_fields, secret }
    end
  end

  def test_resources_need_an_admin
    with_resources do
      get '/api/admin_native/v1/resources'
      assert_equal 401, last_response.status
      get '/api/admin_native/v1/resources/t_refund_reasons'
      assert_equal 401, last_response.status
    end
  end

  def test_list_searches_filters_and_pages
    with_resources do
      Spree::RefundReason.create!(name: 'Zebra damaged', active: false)
      Spree::RefundReason.create!(name: 'Zebra lost', active: true)
      header 'X-Spree-Token', pair!
      body = resource_json(:get, '/t_refund_reasons?q=zebra&per_page=1')
      assert_equal 2, body.dig('meta', 'total_count')
      assert_equal 1, body['data'].size
      body = resource_json(:get, '/t_refund_reasons?q=ZEBRA&filter[active]=false')
      assert_equal ['Zebra damaged'], body['data'].map { |r| r['title'] }
      assert_equal false, body['data'][0]['values']['active']
    end
  end

  def test_create_update_validate_and_delete
    with_resources do
      header 'X-Spree-Token', pair!
      created = resource_json(:post, '/t_refund_reasons', values: { name: 'Wrong size', active: true, id: 999_999 })
      assert_equal 201, last_response.status, last_response.body
      id = created.dig('data', 'id')
      refute_equal '999999', id, 'id is never writable'
      resource_json(:patch, "/t_refund_reasons/#{id}", values: { name: '' })
      assert_equal 422, last_response.status
      assert json.dig('error', 'fields', 'name')
      updated = resource_json(:patch, "/t_refund_reasons/#{id}", values: { name: 'Wrong size (exchange)' })
      assert_equal 'Wrong size (exchange)', updated.dig('data', 'title')
      resource_json(:delete, "/t_refund_reasons/#{id}")
      assert_equal 204, last_response.status
      refute Spree::RefundReason.exists?(id)
    end
  end

  def test_references_show_their_title_and_switched_off_writes_are_refused
    with_resources do
      header 'X-Spree-Token', pair!
      state = Spree::State.joins(:country).first || skip('seed countries and states first')
      body = resource_json(:get, "/t_states/#{state.id}")
      assert_equal({ 'id' => state.country_id.to_s, 'title' => state.country.name }, body.dig('data', 'values', 'country_id'))
      resource_json(:post, '/t_countries', values: { name: 'Atlantis' })
      assert_equal 403, last_response.status
      resource_json(:delete, "/t_countries/#{state.country_id}")
      assert_equal 403, last_response.status
      resource_json(:get, '/t_missing')
      assert_equal 404, last_response.status
    end
  end

  def test_member_actions_run_only_when_available
    with_resources do
      reason = Spree::RefundReason.create!(name: 'Retire me', active: true)
      header 'X-Spree-Token', pair!
      body = resource_json(:get, "/t_refund_reasons/#{reason.id}")
      assert_equal ['retire'], body.dig('data', 'actions')
      body = resource_json(:post, "/t_refund_reasons/#{reason.id}/actions/retire")
      assert_equal 200, last_response.status, last_response.body
      assert_equal 'Retired.', body['message']
      assert_equal [], body.dig('data', 'actions')
      refute reason.reload.active
      resource_json(:post, "/t_refund_reasons/#{reason.id}/actions/retire")
      assert_equal 422, last_response.status
      resource_json(:post, "/t_refund_reasons/#{reason.id}/actions/nope")
      assert_equal 404, last_response.status
    end
  end

  # --- 0.5: admin types ---------------------------------------------------------------------

  # Collects what hooks and actions saw, per test.
  SEEN = [] # rubocop:disable Style/MutableConstant

  def with_types_05
    SEEN.clear
    registry = SpreeAdminNative.resources
    registry.register('t5_countries') do |r|
      r.model 'Spree::Country'
      r.title :name
      r.hidden
      r.fields :auto
      r.actions create: false, update: false, destroy: false
    end
    registry.register('t5_reasons') do |r|
      r.model 'Spree::RefundReason'
      r.label 'Return reasons'
      r.title :name
      r.search :name
      r.fields :auto
      r.field :name, default: 'Other'
      r.editable_if ->(reason) { reason.name != 'Locked' }
      r.deletable_if ->(reason) { !reason.active }
      r.before_save do |reason, admin, op|
        SEEN << [:before, op, admin&.id, reason.name]
        reason.errors.add(:name, 'is not allowed') if reason.name == 'Forbidden'
        reason.errors.add(:base, 'Base says no') if reason.name == 'Base'
        reason.errors.add(:name, 'Name is reserved') if reason.name == 'Reserved'
      end
      r.after_save do |reason, _admin, op|
        SEEN << [:after, op, reason.persisted?]
        reason.errors.add(:base, 'Undone') if reason.name == 'Undo'
      end
      r.action :note, label: 'Note',
                      inputs: [{ name: :note, type: :text, required: true, label: 'Reason' },
                               { name: :count, type: :integer }, { name: :amount, type: :decimal },
                               { name: :flag, type: :boolean }, { name: :on, type: :date },
                               { name: :at, type: :datetime }, { name: :data, type: :json },
                               { name: :country, type: :reference, resource: 't5_countries' },
                               { name: :level, type: :string, default: 'low' }] do |reason, admin, input|
        SEEN << [:note, reason.id, admin.id, input]
        'Noted.'
      end
      r.action(:legacy, &->(reason, _admin) { "Legacy #{reason.name}." })
      r.action :vanish, destructive: true do |reason, _admin|
        reason.destroy!
        'Gone.'
      end
      r.action :hide do |_reason, _admin|
        { message: 'Hidden.', removed: true }
      end
    end
    registry.register('t5_active_reasons') do |r|
      r.model 'Spree::RefundReason'
      r.scope { |rel| rel.where(active: true) }
      r.fields :auto
      r.action :retire do |reason, _admin|
        reason.update!(active: false)
        { 'message' => 'Retired.' }
      end
    end
    registry.register('t5_states') do |r|
      r.model 'Spree::State'
      r.title :name
      r.fields :auto
      r.filter :country_id
      r.field :country_id, :reference, resource: 't5_countries', label: 'Country'
    end
    registry.register('t5_zones') do |r|
      r.model 'Spree::Zone'
      r.title :name
      r.search :name
      r.fields :auto
      r.filter :kind, %w[country state]
      r.filter :default_tax
      r.filter :description, :presence
      r.filter :created_at, :date_range
    end
    yield registry
  ensure
    %w[t5_countries t5_reasons t5_active_reasons t5_states t5_zones].each { |k| registry.unregister(k) }
  end

  def manifest_of(key)
    resource_json(:get, '')['data'].find { |d| d['key'] == key }
  end

  def fields_by_name(manifest)
    manifest['fields'].map { |f| [f['name'], f] }.to_h
  end

  def test_manifest_has_singular_hidden_defaults_inferred_required_and_meta
    with_types_05 do
      header 'X-Spree-Token', pair!
      body = resource_json(:get, '')
      assert_equal SpreeAdminNative::VERSION, body.dig('meta', 'gem_version')
      reasons = body['data'].find { |d| d['key'] == 't5_reasons' }
      assert_equal 'Return reason', reasons['singular']
      assert_equal false, reasons['hidden']
      assert_equal true, body['data'].find { |d| d['key'] == 't5_countries' }['hidden']
      resource_json(:get, '/t5_countries?per_page=1')
      assert_equal 200, last_response.status, 'hidden types stay listable'
      fields = fields_by_name(reasons)
      assert_equal 'Other', fields['name']['default']
      assert_equal true, fields['active']['default'], 'auto fields take the column default, cast'
      refute fields['created_at'].key?('default'), 'not for timestamps'
      zone_fields = fields_by_name(manifest_of('t5_zones'))
      assert_equal 'state', zone_fields['kind']['default']
      assert_equal false, zone_fields['default_tax']['default']
      assert_equal true, zone_fields['name']['required'], 'presence validator'
      assert_equal false, zone_fields['description']['required']
      state_fields = fields_by_name(manifest_of('t5_states'))
      assert_equal true, state_fields['country_id']['required'], "the association's presence validator marks its foreign key"
      assert_equal true, state_fields['name']['required']
      assert_equal false, state_fields['abbr']['required']
    end
  end

  def test_non_optional_belongs_to_marks_its_foreign_key
    definition = SpreeAdminNative::Resources::Definition.new('t5_probe')
    definition.model 'SpreeAdminNative::Device'
    definition.fields :auto
    reflection = SpreeAdminNative::Device.reflect_on_all_associations(:belongs_to).first || skip('devices belong to nothing')
    field = definition.resolved_field(reflection.foreign_key) || skip('no foreign key column')
    optional = reflection.options.fetch(:optional) { !SpreeAdminNative::Device.belongs_to_required_by_default }
    assert_equal !optional, field.required
  end

  def test_can_rules_refuse_update_and_delete_per_record
    with_types_05 do
      locked = Spree::RefundReason.create!(name: 'Locked', active: true)
      open = Spree::RefundReason.create!(name: 'Open', active: false)
      header 'X-Spree-Token', pair!
      assert_equal({ 'update' => false, 'destroy' => false }, resource_json(:get, "/t5_reasons/#{locked.id}").dig('data', 'can'))
      assert_equal({ 'update' => true, 'destroy' => true }, resource_json(:get, "/t5_reasons/#{open.id}").dig('data', 'can'))
      resource_json(:patch, "/t5_reasons/#{locked.id}", values: { name: 'Unlocked' })
      assert_equal 403, last_response.status
      assert_equal 'not_allowed', json.dig('error', 'code')
      assert_equal 'Locked', locked.reload.name
      resource_json(:delete, "/t5_reasons/#{locked.id}")
      assert_equal 403, last_response.status
      assert_equal 'not_allowed', json.dig('error', 'code')
      assert Spree::RefundReason.exists?(locked.id)
      resource_json(:delete, "/t5_reasons/#{open.id}")
      assert_equal 204, last_response.status
      # The type's switches still apply on top: a read-only type says so on every record.
      country = Spree::Country.first
      assert_equal({ 'update' => false, 'destroy' => false }, resource_json(:get, "/t5_countries/#{country.id}").dig('data', 'can'))
    end
  end

  def test_save_hooks_see_assigned_values_and_can_refuse
    with_types_05 do
      header 'X-Spree-Token', pair!
      created = resource_json(:post, '/t5_reasons', values: { name: 'Hooked' })
      assert_equal 201, last_response.status, last_response.body
      assert_equal [[:before, :create, @admin.id, 'Hooked'], [:after, :create, true]], SEEN
      SEEN.clear
      id = created.dig('data', 'id')
      resource_json(:patch, "/t5_reasons/#{id}", values: { name: 'Hooked again' })
      assert_equal 200, last_response.status
      assert_equal [[:before, :update, @admin.id, 'Hooked again'], [:after, :update, true]], SEEN

      resource_json(:post, '/t5_reasons', values: { name: 'Forbidden' })
      assert_equal 422, last_response.status
      assert_equal ['is not allowed'], json.dig('error', 'fields', 'name')
      assert_equal 'Name is not allowed', json.dig('error', 'message')
      refute Spree::RefundReason.exists?(name: 'Forbidden')
      resource_json(:post, '/t5_reasons', values: { name: 'Reserved' })
      assert_equal 'Name is reserved', json.dig('error', 'message'), 'a message naming its field is not prefixed again'

      resource_json(:patch, "/t5_reasons/#{id}", values: { name: 'Base' })
      assert_equal 422, last_response.status
      assert_equal ['Base says no'], json.dig('error', 'fields', 'base'), 'base errors stay base'
      assert_equal 'Hooked again', Spree::RefundReason.find(id).name

      resource_json(:post, '/t5_reasons', values: { name: 'Undo' })
      assert_equal 422, last_response.status
      assert_equal ['Undone'], json.dig('error', 'fields', 'base')
      refute Spree::RefundReason.exists?(name: 'Undo'), 'after_save errors roll the save back'
    end
  end

  def test_action_inputs_are_cast_required_and_unknown_keys_ignored
    with_types_05 do
      reason = Spree::RefundReason.create!(name: 'Inputs', active: true)
      country = Spree::Country.first
      header 'X-Spree-Token', pair!
      actions = manifest_of('t5_reasons')['actions']
      note = actions.find { |a| a['name'] == 'note' }
      assert_equal({ 'name' => 'note', 'type' => 'text', 'label' => 'Reason', 'required' => true, 'readonly' => false },
                   note['inputs'].first)
      assert_equal 't5_countries', note['inputs'].find { |i| i['name'] == 'country' }['resource']
      assert_equal 'low', note['inputs'].last['default']
      refute actions.find { |a| a['name'] == 'legacy' }.key?('inputs')

      body = resource_json(:post, "/t5_reasons/#{reason.id}/actions/note",
                           input: { note: 'Because', count: '3', amount: '2.50', flag: 'false', on: '2026-01-02',
                                    at: '2026-01-02T03:04:05Z', data: '{"a":1}', country: country.id, extra: 'ignored' })
      assert_equal 200, last_response.status, last_response.body
      assert_equal 'Noted.', body['message']
      _, seen_id, admin_id, input = SEEN.last
      assert_equal [reason.id, @admin.id], [seen_id, admin_id]
      assert_equal %i[amount at count country data flag level note on], input.keys.sort
      assert_equal 'Because', input[:note]
      assert_equal 3, input[:count]
      assert_kind_of BigDecimal, input[:amount]
      assert_equal BigDecimal('2.5'), input[:amount]
      assert_equal false, input[:flag]
      assert_equal Date.new(2026, 1, 2), input[:on]
      assert_equal Time.utc(2026, 1, 2, 3, 4, 5), input[:at]
      assert_equal({ 'a' => 1 }, input[:data])
      assert_equal country.id.to_s, input[:country]
      assert_equal 'low', input[:level]

      resource_json(:post, "/t5_reasons/#{reason.id}/actions/note", input: { count: '1' })
      assert_equal 422, last_response.status
      assert_equal 'invalid', json.dig('error', 'code')
      assert_equal({ 'note' => ["can't be blank"] }, json.dig('error', 'fields'))
      resource_json(:post, "/t5_reasons/#{reason.id}/actions/note", input: { note: '  ' })
      assert_equal ["can't be blank"], json.dig('error', 'fields', 'note')
      resource_json(:post, "/t5_reasons/#{reason.id}/actions/note", input: { note: 'x', count: 'many' })
      assert_equal 422, last_response.status
      assert json.dig('error', 'fields', 'count')

      # JSON clients (the app) send numbers, not strings.
      resource_json(:post, "/t5_reasons/#{reason.id}/actions/note", input: { note: 'x', count: 7, amount: 2.5 })
      assert_equal 200, last_response.status, last_response.body
      assert_equal 7, SEEN.last.last[:count]
      assert_equal BigDecimal('2.5'), SEEN.last.last[:amount]
      resource_json(:post, "/t5_reasons/#{reason.id}/actions/note", input: { note: 'x', count: 7.5 })
      assert_equal 422, last_response.status, 'a fractional number is not an integer'

      body = resource_json(:post, "/t5_reasons/#{reason.id}/actions/legacy")
      assert_equal 200, last_response.status, last_response.body
      assert_equal 'Legacy Inputs.', body['message'], 'two-argument blocks (even lambdas) still work'
    end
  end

  def test_actions_report_removed_records
    with_types_05 do
      header 'X-Spree-Token', pair!
      gone = Spree::RefundReason.create!(name: 'Vanish', active: true)
      body = resource_json(:post, "/t5_reasons/#{gone.id}/actions/vanish")
      assert_equal 200, last_response.status, last_response.body
      assert_equal({ 'data' => nil, 'removed' => true, 'message' => 'Gone.' }, body)

      kept = Spree::RefundReason.create!(name: 'Hide', active: true)
      body = resource_json(:post, "/t5_reasons/#{kept.id}/actions/hide")
      assert_equal({ 'data' => nil, 'removed' => true, 'message' => 'Hidden.' }, body)
      assert Spree::RefundReason.exists?(kept.id)

      body = resource_json(:post, "/t5_active_reasons/#{kept.id}/actions/retire")
      assert_equal({ 'data' => nil, 'removed' => true, 'message' => 'Retired.' }, body, 'no longer in the type')

      body = resource_json(:post, "/t5_reasons/#{kept.id}/actions/note", input: { note: 'still here' })
      assert_equal kept.id.to_s, body.dig('data', 'id')
      refute body.key?('removed')
    end
  end

  def test_filters_by_type
    with_types_05 do
      header 'X-Spree-Token', pair!
      filters = manifest_of('t5_zones')['filters'].map { |f| [f['name'], f] }.to_h
      assert_equal({ 'name' => 'kind', 'label' => 'Kind', 'type' => 'enum', 'options' => %w[country state] }, filters['kind'])
      assert_equal({ 'name' => 'default_tax', 'label' => 'Default tax', 'type' => 'enum', 'options' => [true, false] }, filters['default_tax'])
      assert_equal({ 'name' => 'description', 'label' => 'Description', 'type' => 'presence', 'options' => %w[set unset] }, filters['description'])
      assert_equal({ 'name' => 'created_at', 'label' => 'Created at', 'type' => 'date_range' }, filters['created_at'])
      assert_equal({ 'name' => 'country_id', 'label' => 'Country', 'type' => 'reference', 'resource' => 't5_countries' },
                   manifest_of('t5_states')['filters'].first)

      described = Spree::Zone.create!(name: 'F5 described', description: 'Somewhere', kind: 'country')
      blank = Spree::Zone.create!(name: 'F5 blank', description: nil, kind: 'state')
      described.update_columns(created_at: Time.zone.parse('2026-03-01 00:00:00'))
      blank.update_columns(created_at: Time.zone.parse('2026-03-03 23:59:59'))
      titles = ->(query) { resource_json(:get, "/t5_zones?q=f5&#{query}")['data'].map { |r| r['title'] }.sort }
      assert_equal ['F5 blank', 'F5 described'], titles.call('')
      assert_equal ['F5 described'], titles.call('filter[description]=set')
      assert_equal ['F5 blank'], titles.call('filter[description]=unset')
      assert_equal ['F5 blank'], titles.call('filter[kind]=state')
      assert_equal ['F5 blank', 'F5 described'], titles.call('filter[created_at][from]=2026-03-01&filter[created_at][to]=2026-03-03')
      assert_equal ['F5 described'], titles.call('filter[created_at][to]=2026-03-02')
      assert_equal ['F5 blank'], titles.call('filter[created_at][from]=2026-03-02')
      assert_equal [], titles.call('filter[created_at][from]=2026-03-04')

      state = Spree::State.first
      body = resource_json(:get, "/t5_states?per_page=100&filter[country_id]=#{state.country_id}")
      assert_includes body['data'].map { |r| r['id'] }, state.id.to_s
      assert_equal Spree::State.where(country_id: state.country_id).count, body.dig('meta', 'total_count')
    end
  end

  def test_configure_runs_before_and_after_registration_and_on_reregistration
    registry = SpreeAdminNative.resources
    registry.configure('t5_conf') { |r| r.field :abbr, :string, label: 'Code' } # before registration
    register = lambda do
      registry.register('t5_conf') do |r|
        r.model 'Spree::State'
        r.field :name, :string
      end
    end
    register.call
    assert_equal 'Code', registry['t5_conf'].resolved_field(:abbr).label
    2.times { registry.configure('t5_conf') { |r| r.search :name, :abbr } } # after; the same block counts once
    assert_equal %i[name abbr], registry['t5_conf'].search_attrs
    register.call # a reload registers it again: both run again
    definition = registry['t5_conf']
    assert_equal 'Code', definition.resolved_field(:abbr).label
    assert_equal %i[name abbr], definition.search_attrs
    assert_equal 2, registry.instance_variable_get(:@configurations)['t5_conf'].size
  ensure
    registry.unregister('t5_conf')
    registry.instance_variable_get(:@configurations).delete('t5_conf')
  end

  def test_version_conflicts
    with_types_05 do
      reason = Spree::RefundReason.create!(name: 'Versioned', active: false)
      header 'X-Spree-Token', pair!
      version = resource_json(:get, "/t5_reasons/#{reason.id}").dig('data', 'version')
      assert_equal reason.reload.updated_at.utc.iso8601(6), version
      Spree::RefundReason.where(id: reason.id).update_all(name: 'Changed elsewhere', updated_at: 1.minute.from_now)
      resource_json(:patch, "/t5_reasons/#{reason.id}", values: { name: 'Mine' }, version: version)
      assert_equal 409, last_response.status
      assert_equal({ 'code' => 'conflict', 'message' => 'Someone else changed this. Reload to see their changes.' }, json['error'])
      assert_equal 'Changed elsewhere', reason.reload.name
      current = resource_json(:get, "/t5_reasons/#{reason.id}").dig('data', 'version')
      body = resource_json(:patch, "/t5_reasons/#{reason.id}", values: { name: 'Mine' }, version: current)
      assert_equal 200, last_response.status, last_response.body
      refute_equal current, body.dig('data', 'version')
      resource_json(:patch, "/t5_reasons/#{reason.id}", values: { name: 'No version sent' })
      assert_equal 200, last_response.status, 'version is optional'
    end
  end

  def test_reference_values_are_preloaded_per_page
    with_types_05 do
      header 'X-Spree-Token', pair!
      resource_json(:get, '/t5_states?per_page=2') # warm caches
      count = lambda do |per_page|
        queries = 0
        counter = lambda do |_name, _start, _finish, _id, payload|
          next if payload[:cached] || %w[SCHEMA TRANSACTION].include?(payload[:name])
          next if payload[:sql].to_s =~ /\A\s*(SAVEPOINT|RELEASE|ROLLBACK|BEGIN|COMMIT)/i

          queries += 1
        end
        ActiveSupport::Notifications.subscribed(counter, 'sql.active_record') do
          resource_json(:get, "/t5_states?per_page=#{per_page}")
        end
        assert_equal 200, last_response.status
        assert_equal per_page, json['data'].size
        queries
      end
      few = count.call(2)
      many = count.call(40)
      assert_equal few, many, 'queries do not grow with the page'
      row = json['data'].first
      state = Spree::State.find(row['id'])
      assert_equal({ 'id' => state.country_id.to_s, 'title' => state.country.name }, row['values']['country_id'])
    end
  end

  def test_association_errors_are_reported_under_the_foreign_key
    with_types_05 do
      header 'X-Spree-Token', pair!
      resource_json(:post, '/t5_states', values: { name: 'Nowhere state' })
      assert_equal 422, last_response.status
      fields = json.dig('error', 'fields')
      assert fields['country_id'], last_response.body
      refute fields.key?('country')
    end
  end

  # --- 0.5: uploads, image and file fields ------------------------------------------------

  class SanFileCountry < ActiveRecord::Base
    self.table_name = 'spree_countries'
    has_one_attached :flag
  end

  def upload(io, filename, content_type)
    post '/api/admin_native/v1/resources/uploads', file: Rack::Test::UploadedFile.new(io, content_type, original_filename: filename)
    last_response.body.empty? ? {} : json
  end

  def with_file_types
    registry = SpreeAdminNative.resources
    registry.register('t5_images') do |r|
      r.model 'Spree::Image'
      r.title :alt
      r.field :alt, :string
      r.field :attachment, :image
      r.field :viewable_id, :integer, readonly: true
      r.actions create: false, destroy: false
    end
    registry.register('t5_flags') do |r|
      r.model SanFileCountry.name
      r.title :name
      r.search :name
      r.field :name, :string
      r.field :flag, :file
    end
    yield
  ensure
    %w[t5_images t5_flags].each { |k| registry.unregister(k) }
  end

  def test_uploads_need_an_admin_and_a_file
    post '/api/admin_native/v1/resources/uploads', file: Rack::Test::UploadedFile.new(StringIO.new(png), 'image/png', original_filename: 'a.png')
    assert_equal 401, last_response.status
    header 'X-Spree-Token', pair!
    post '/api/admin_native/v1/resources/uploads', {}
    assert_equal 422, last_response.status
    assert_equal ["can't be blank"], json.dig('error', 'fields', 'file')
  end

  def test_upload_then_attach_an_image
    with_file_types do
      product, = make_product('U5 image product', [1])
      image = add_image(product.master, alt: 'Before')
      old_blob = image.attachment.blob
      header 'X-Spree-Token', pair!
      body = upload(StringIO.new(png), 'new.png', 'image/png')
      assert_equal 201, last_response.status, last_response.body
      data = body['data']
      assert_equal %w[byte_size content_type filename signed_id url], data.keys.sort
      assert_equal 'new.png', data['filename']
      assert_equal 'image/png', data['content_type']
      assert_equal png.bytesize, data['byte_size']
      assert data['url'].start_with?('http://localhost/rails/active_storage/blobs/'), data['url']

      field = manifest_of('t5_images')['fields'].find { |f| f['name'] == 'attachment' }
      assert_equal false, field['readonly']
      updated = resource_json(:patch, "/t5_images/#{image.id}", values: { attachment: data['signed_id'], alt: 'After' })
      assert_equal 200, last_response.status, last_response.body
      assert_equal ActiveStorage::Blob.find_signed(data['signed_id']).id, image.reload.attachment.blob.id
      refute_equal old_blob.id, image.attachment.blob.id
      url = updated.dig('data', 'values', 'attachment')
      assert_kind_of String, url
      assert url.start_with?('http://localhost/rails/active_storage/blobs/'), url

      resource_json(:patch, "/t5_images/#{image.id}", values: { attachment: 'not-a-signed-id' })
      assert_equal 422, last_response.status
      assert json.dig('error', 'fields', 'attachment')
      # Spree requires the picture, so removing it is refused by the model's own validation.
      resource_json(:patch, "/t5_images/#{image.id}", values: { attachment: nil })
      assert_equal 422, last_response.status
      assert json.dig('error', 'fields', 'attachment')
      assert image.reload.attachment.attached?
    end
  end

  def test_upload_then_attach_and_purge_a_file
    with_file_types do
      country = SanFileCountry.first
      header 'X-Spree-Token', pair!
      assert_nil resource_json(:get, "/t5_flags/#{country.id}").dig('data', 'values', 'flag')
      assert_equal 'file', manifest_of('t5_flags')['fields'].find { |f| f['name'] == 'flag' }['type']
      signed = upload(StringIO.new('a,b'), 'flag.csv', 'text/csv').dig('data', 'signed_id')
      value = resource_json(:patch, "/t5_flags/#{country.id}", values: { flag: signed }).dig('data', 'values', 'flag')
      assert_equal 200, last_response.status, last_response.body
      assert_equal %w[byte_size content_type filename url], value.keys.sort
      assert_equal 'flag.csv', value['filename']
      assert_equal 'text/csv', value['content_type']
      assert_equal 3, value['byte_size']
      assert value['url'].start_with?('http://localhost/rails/active_storage/blobs/'), value['url']
      assert country.reload.flag.attached?
      listed = resource_json(:get, "/t5_flags?q=#{CGI.escape(country.name)}")['data'].find { |r| r['id'] == country.id.to_s }
      assert_equal 'flag.csv', listed.dig('values', 'flag', 'filename')

      body = resource_json(:patch, "/t5_flags/#{country.id}", values: { flag: nil })
      assert_equal 200, last_response.status, last_response.body
      assert_nil body.dig('data', 'values', 'flag')
      refute SanFileCountry.find(country.id).flag.attached?
    end
  end

  def test_uploads_over_25_mb_are_refused
    header 'X-Spree-Token', pair!
    before = ActiveStorage::Blob.count
    upload(StringIO.new('0' * (25 * 1024 * 1024 + 1)), 'big.bin', 'application/octet-stream')
    assert_equal 413, last_response.status
    assert_equal 'too_large', json.dig('error', 'code')
    assert_equal before, ActiveStorage::Blob.count
  end

  # --- 0.5: built-in lookups and hardening ------------------------------------------------

  def test_built_in_lookups_are_hidden_read_only_and_minimal
    header 'X-Spree-Token', pair!
    data = resource_json(:get, '')['data']
    builtins = data.select { |d| d['key'].start_with?('spree_') }.map { |d| [d['key'], d] }.to_h
    assert_equal %w[spree_orders spree_products spree_taxons spree_users spree_variants], builtins.keys.sort
    builtins.each_value do |d|
      assert_equal true, d['hidden']
      assert_equal [false, false, false], [d['create'], d['update'], d['destroy']]
      assert(d['fields'].all? { |f| f['readonly'] })
    end
    assert_equal %w[email created_at], builtins['spree_users']['fields'].map { |f| f['name'] }
    assert_equal %w[name slug created_at], builtins['spree_products']['fields'].map { |f| f['name'] }
    assert_equal %w[sku created_at], builtins['spree_variants']['fields'].map { |f| f['name'] }
    assert_equal %w[number email created_at], builtins['spree_orders']['fields'].map { |f| f['name'] }
    assert_equal %w[name permalink created_at], builtins['spree_taxons']['fields'].map { |f| f['name'] }
    assert_equal 'email', builtins['spree_users']['title_field']

    # 0.7: taxons are titled with their pretty name (ancestors -> name) and searched by name.
    taxon = Spree::Taxon.where.not(parent_id: nil).first || skip('no child taxons')
    row = resource_json(:get, "/spree_taxons?q=#{CGI.escape(taxon.name)}")['data'].find { |r| r['id'] == taxon.id.to_s }
    assert_equal [taxon.pretty_name, taxon.permalink], [row['title'], row['subtitle']]
    assert_includes row['title'], ' -> '

    order = Spree::Order.complete.first
    row = resource_json(:get, "/spree_orders?q=#{order.number.downcase}")['data'].first
    assert_equal [order.number, order.email], [row['title'], row['subtitle']]
    variant = Spree::Variant.where.not(sku: [nil, '']).where(is_master: false).first || skip('no variant with a SKU')
    row = resource_json(:get, "/spree_variants?q=#{CGI.escape(variant.sku)}")['data'].find { |r| r['id'] == variant.id.to_s }
    assert_equal [variant.sku, variant.product.name], [row['title'], row['subtitle']]
    product = Spree::Product.first
    assert_includes resource_json(:get, "/spree_products?q=#{product.slug}")['data'].map { |r| r['id'] }, product.id.to_s
    user = resource_json(:get, "/spree_users?q=#{CGI.escape(@admin.email)}")['data'].first
    assert_equal [@admin.id.to_s, @admin.email], [user['id'], user['title']]
    assert_equal %w[created_at email], user['values'].keys.sort
    resource_json(:post, '/spree_products', values: { name: 'Nope' })
    assert_equal 403, last_response.status
  end

  def test_a_host_type_overrides_a_built_in_in_any_order
    registry = SpreeAdminNative.resources
    registry.register('spree_products') do |r|
      r.model 'Spree::Product'
      r.label 'Catalog'
      r.fields :auto
    end
    SpreeAdminNative::Resources.register_builtins(registry) # the gem registering after the host
    header 'X-Spree-Token', pair!
    products = resource_json(:get, '')['data'].select { |d| d['key'] == 'spree_products' }
    assert_equal 1, products.size
    assert_equal 'Catalog', products.first['label']
    assert_equal false, products.first['hidden']
    registry.unregister('spree_products')
    refute(resource_json(:get, '')['data'].any? { |d| d['key'] == 'spree_products' }, 'unregister removes the lookup')
    SpreeAdminNative::Resources.register_builtins(registry)
    assert_equal true, manifest_of('spree_products')['hidden']
  ensure
    registry.unregister('spree_products')
    SpreeAdminNative::Resources.register_builtins(registry)
  end

  def test_references_can_point_at_built_in_lookups
    registry = SpreeAdminNative.resources
    registry.register('t5_line_items') do |r|
      r.model 'Spree::LineItem'
      r.field :quantity, :integer
      r.field :variant_id, :reference, resource: 'spree_variants'
      r.field :order_id, :reference, resource: 'spree_orders'
    end
    item = Spree::LineItem.first || skip('no line items')
    header 'X-Spree-Token', pair!
    values = resource_json(:get, "/t5_line_items/#{item.id}").dig('data', 'values')
    assert_equal({ 'id' => item.order_id.to_s, 'title' => item.order.number }, values['order_id'])
    assert_equal item.variant_id.to_s, values.dig('variant_id', 'id')
  ensure
    registry.unregister('t5_line_items')
  end

  class SanNoConnection < ActiveRecord::Base
    def self.table_exists?
      raise ActiveRecord::ConnectionNotEstablished, 'No connection pool'
    end
  end

  def test_secret_names_and_no_database
    %w[stream_key signed_payload jwt jwt_token cvv card_cvv password api_key].each do |name|
      assert_match SpreeAdminNative::Resources::SECRET, name
    end
    refute_match SpreeAdminNative::Resources::SECRET, 'stream_url'
    registry = SpreeAdminNative.resources
    registry.register('t5_secrets') do |r|
      r.model 'Spree::Zone'
      r.fields :auto
      %i[stream_key signed_payload jwt cvv].each { |n| r.field n, :string }
    end
    names = registry['t5_secrets'].manifest[:fields].map { |f| f[:name] }
    assert_includes names, 'name'
    %w[stream_key signed_payload jwt cvv].each { |n| refute_includes names, n }

    registry.register('t5_offline') { |r| r.model SanNoConnection.name }
    refute registry.definition('t5_offline').available?
    assert_nil registry['t5_offline']
    refute_includes registry.available.map(&:key), 't5_offline'
  ensure
    %w[t5_secrets t5_offline].each { |k| registry.unregister(k) }
  end

  # --- 0.6: app version gate --------------------------------------------------------------

  AppVersion = SpreeAdminNative::AppVersion

  def with_gem_config(values)
    config = SpreeAdminNative.config
    previous = values.keys.map { |key| [key, config.public_send(key)] }.to_h
    values.each { |key, value| config.public_send("#{key}=", value) }
    yield
  ensure
    previous.each { |key, value| config.public_send("#{key}=", value) }
  end

  # Stubs Net::HTTP.start for the App Store lookup. `live` is the version the App Store serves (nil:
  # no app); `error` is raised instead; `status` other than 200 is an HTTP failure. Yields the list
  # of lookups made, each { host:, path:, options: }.
  def stub_app_store(live: nil, error: nil, status: 200)
    lookups = []
    original = Net::HTTP.method(:start)
    Net::HTTP.define_singleton_method(:start) do |host, _port = nil, *rest, &block|
      http = Object.new
      http.define_singleton_method(:request) do |request|
        lookups << { host: host, path: request.path, options: rest.last }
        raise error if error

        results = live ? [{ 'bundleId' => 'com.example.admin', 'version' => live }] : []
        response = (status == 200 ? Net::HTTPOK : Net::HTTPServiceUnavailable).new('1.1', status.to_s, '')
        response.instance_variable_set(:@body, { resultCount: results.size, results: results }.to_json)
        response.instance_variable_set(:@read, true)
        response
      end
      block.call(http)
    end
    yield lookups
  ensure
    Net::HTTP.define_singleton_method(:start, original)
  end

  def app_version(attrs)
    AppVersion.new({ platform: 'ios' }.merge(attrs))
  end

  def test_app_version_validates_formats_order_and_links
    AppVersion.delete_all
    assert app_version(minimum_version: '1.2.3', recommended_version: '1.10.0').valid?
    %w[1.2 1.2.3.4 v1.2.3 1.2.3-beta abc].each do |bad|
      record = app_version(minimum_version: bad, recommended_version: bad)
      refute record.valid?, bad
      assert_equal ['must be a version like 1.2.3'], record.errors[:minimum_version], bad
      assert_equal ['must be a version like 1.2.3'], record.errors[:recommended_version], bad
    end

    below = app_version(minimum_version: '1.10.0', recommended_version: '1.9.0')
    refute below.valid?
    assert_equal ["can't be below the minimum version (1.10.0)"], below.errors[:recommended_version]
    assert app_version(minimum_version: '1.2.0', recommended_version: '1.2.0').valid?, 'recommended may equal minimum'

    assert app_version(update_url: 'https://apps.apple.com/app/id123').valid?
    ['http://apps.apple.com/app/id123', 'itms-apps://apps.apple.com/app/id123', 'https://', 'not a link', 'https:foo'].each do |bad|
      record = app_version(update_url: bad)
      refute record.valid?, bad
      assert_equal ['must be an https link'], record.errors[:update_url], bad
    end

    blank = app_version(minimum_version: '', recommended_version: '  ', update_url: ' ')
    assert blank.valid?
    assert_nil blank.minimum_version
    assert_nil blank.recommended_version
    assert_nil blank.update_url
    assert blank.cleared?
    assert app_version(platform: 'android', recommended_version: '2.0.0').valid?, 'either version alone'

    refute app_version(platform: 'web').valid?
    AppVersion.create!(platform: 'ios', minimum_version: '1.0.0')
    refute app_version(minimum_version: '1.0.0').valid?, 'one row per platform'
  end

  def test_app_store_check_compares_with_the_live_version
    AppVersion.delete_all
    with_gem_config(ios_bundle_id: 'com.example.admin') do
      stub_app_store(live: '1.2.0') do |lookups|
        assert app_version(minimum_version: '1.1.0', recommended_version: '1.2.0').valid?, 'below and at the live version'
        lookup = lookups.last
        assert_equal 'itunes.apple.com', lookup[:host]
        assert_equal '/lookup?bundleId=com.example.admin', lookup[:path]
        assert_equal 5, lookup[:options][:open_timeout]
        assert_equal 5, lookup[:options][:read_timeout]
        assert lookup[:options][:use_ssl]

        above = app_version(minimum_version: '1.2.1', recommended_version: '1.3.0')
        refute above.valid?
        assert_match(/is above 1\.2\.0, the version live on the App Store/, above.errors[:minimum_version].first)
        assert_match(/Allow ahead of the App Store/, above.errors[:recommended_version].first)

        refute AppVersion.new(platform: 'all', recommended_version: '1.3.0').valid?, 'the all row is checked too'
        assert app_version(minimum_version: '0.0.0').valid?, '0.0.0 is no minimum'

        count = lookups.size
        assert app_version(minimum_version: '2.0.0', allow_ahead_of_store: true).valid?, 'ahead allowed'
        assert AppVersion.new(platform: 'android', minimum_version: '9.0.0').valid?, 'Android is not looked up'
        assert_equal count, lookups.size
      end
    end
  end

  def test_app_store_lookup_failures_are_validation_messages
    AppVersion.delete_all
    with_gem_config(ios_bundle_id: 'com.example.admin') do
      [{ live: nil }, { status: 503 }, { error: Net::OpenTimeout }, { error: SocketError.new('getaddrinfo') },
       { error: OpenSSL::SSL::SSLError }, { error: JSON::ParserError }].each do |failure|
        stub_app_store(**failure) do
          record = app_version(minimum_version: '1.0.0')
          refute record.valid?, failure.inspect
          assert_match(/no live version of com\.example\.admin, or couldn't be reached/, record.errors[:base].first)
          assert_match(/Tick "Allow ahead of the App Store"/, record.errors[:base].first)
          assert app_version(minimum_version: '1.0.0', allow_ahead_of_store: true).valid?
        end
      end
    end
  end

  def test_app_store_check_is_skipped_without_a_bundle_id_or_a_version_change
    AppVersion.delete_all
    stub_app_store(live: '1.0.0') do |lookups|
      with_gem_config(ios_bundle_id: nil) { assert app_version(minimum_version: '9.9.9').valid? }
      with_gem_config(ios_bundle_id: ' ') { assert app_version(minimum_version: '9.9.9').valid? }
      assert_empty lookups

      with_gem_config(ios_bundle_id: 'com.example.admin') do
        row = AppVersion.create!(platform: 'ios', minimum_version: '2.0.0', allow_ahead_of_store: true)
        row.update_column(:allow_ahead_of_store, false)
        row.reload.update_url = 'https://apps.apple.com/app/id123'
        assert row.valid?, 'editing the link alone needs no lookup'
        assert_equal 0, lookups.size
        row.minimum_version = '2.0.1'
        refute row.valid?
        assert_equal 1, lookups.size
      end
    end
  end

  def test_effective_settings_prefer_the_platform_row_then_all
    AppVersion.delete_all
    none = { minimum_version: nil, recommended_version: nil, update_url: nil }
    assert_equal none, AppVersion.effective('ios')

    AppVersion.create!(platform: 'all', minimum_version: '1.0.0', recommended_version: '1.1.0', update_url: 'https://example.com/all')
    all = { minimum_version: '1.0.0', recommended_version: '1.1.0', update_url: 'https://example.com/all' }
    assert_equal all, AppVersion.effective('ios')
    assert_equal all, AppVersion.effective('android')

    AppVersion.create!(platform: 'ios', recommended_version: '2.0.0')
    assert_equal({ minimum_version: nil, recommended_version: '2.0.0', update_url: nil }, AppVersion.effective('ios'))
    assert_equal({ minimum_version: nil, recommended_version: '2.0.0', update_url: nil }, AppVersion.effective(' IOS '))
    assert_equal all, AppVersion.effective('android')
    assert_equal all, AppVersion.effective('windows'), 'an unknown platform reads the all row'
    assert_equal all, AppVersion.effective(nil)

    AppVersion.where(platform: 'all').delete_all
    assert_equal none, AppVersion.effective('android')
  end

  def app_version_json(query)
    get '/api/admin_native/v1/app_version', query
    assert_equal 200, last_response.status, last_response.body
    json['data']
  end

  def test_app_version_endpoint
    AppVersion.delete_all
    unset = { 'minimum_version' => nil, 'recommended_version' => nil, 'update_url' => nil,
              'update_required' => false, 'update_recommended' => false }
    assert_equal unset, app_version_json(platform: 'ios', version: '1.0.0')
    assert_equal unset, app_version_json({})

    AppVersion.create!(platform: 'ios', minimum_version: '1.1.0', recommended_version: '1.2.0', update_url: 'https://apps.apple.com/app/id123')
    data = app_version_json(platform: 'ios', version: '1.0.0')
    assert_equal({ 'minimum_version' => '1.1.0', 'recommended_version' => '1.2.0', 'update_url' => 'https://apps.apple.com/app/id123',
                   'update_required' => true, 'update_recommended' => true }, data)
    {
      '1.1.0' => [false, true], '1.1.9' => [false, true], '1.2.0' => [false, false], '1.10.0' => [false, false],
      '1.1' => [false, true], '1.0.9-beta.2' => [true, true], '1.2.0+45' => [false, false], '1' => [true, true],
      nil => [false, false], '' => [false, false], 'abc' => [false, false], '1.2.3.4' => [false, false], 'v1.0.0' => [false, false]
    }.each do |version, (required, recommended)|
      data = app_version_json(version ? { platform: 'ios', version: version } : { platform: 'ios' })
      assert_equal [required, recommended], [data['update_required'], data['update_recommended']], version.inspect
      assert_equal '1.1.0', data['minimum_version']
    end

    assert_equal unset, app_version_json(platform: 'android', version: '1.0.0')
    AppVersion.create!(platform: 'all', minimum_version: '0.0.0', recommended_version: '3.0.0')
    data = app_version_json(platform: 'android', version: '0.0.0')
    assert_equal '0.0.0', data['minimum_version']
    assert_equal false, data['update_required'], 'a 0.0.0 minimum is no minimum'
    assert_equal true, data['update_recommended']
    data = app_version_json(platform: 'windows', version: '3.0.0')
    assert_equal ['0.0.0', '3.0.0', false, false], data.values_at('minimum_version', 'recommended_version', 'update_required', 'update_recommended')

    header 'X-Spree-Token', 'san_not_a_real_token'
    assert_equal '1.1.0', app_version_json(platform: 'ios', version: '1.0.0')['minimum_version'], 'public, a bad token is ignored'

    with_gem_config(app_version_gate: false) do
      get '/api/admin_native/v1/app_version', platform: 'ios'
      assert_equal 404, last_response.status
    end
  end

  def test_capability_follows_the_gate_switch
    get '/api/admin_native/v1/capabilities'
    assert_includes json['capabilities'], 'app.versionGate'
    with_gem_config(app_version_gate: false) do
      get '/api/admin_native/v1/capabilities'
      refute_includes json['capabilities'], 'app.versionGate'
    end
  end

  # --- 0.6: the admin app page's App versions section --------------------------------------

  def sign_in_to_admin(user)
    Warden.test_mode!
    login_as(user, scope: :spree_user)
  end

  def form_token(form_id)
    last_response.body[/id="#{form_id}".*?name="authenticity_token" value="([^"]+)"/m, 1] || raise("no token for #{form_id}")
  end

  def save_app_version(platform, values)
    get '/admin/admin_native_devices'
    assert_equal 200, last_response.status
    patch "/admin/admin_native_app_versions/#{platform}", authenticity_token: form_token("app-version-#{platform}"), app_version: values
  end

  def test_admin_page_shows_and_saves_app_versions
    AppVersion.delete_all
    sign_in_to_admin(@admin)
    get '/admin/admin_native_devices'
    assert_equal 200, last_response.status
    body = last_response.body
    assert_includes body, 'App versions'
    ["Below the minimum, the app can't be used until it's updated.", 'Below the recommended version, people are asked, not forced, to update.',
     'Leave a version blank for none.'].each { |hint| assert_includes body, CGI.escapeHTML(hint) }
    assert_includes body, 'Pair a device', 'the devices section stays'
    forms = %w[ios android all].map { |p| [p, body[/<form[^>]*id="app-version-#{p}".*?<\/form>/m]] }.to_h
    forms.each { |p, form| refute_nil form, p }
    assert_includes forms['ios'], 'Allow ahead of the App Store'
    assert_includes forms['all'], 'Allow ahead of the App Store'
    refute_includes forms['android'], 'Allow ahead of the App Store'
    assert_equal 2, body.scan('No versions set').size

    save_app_version('ios', minimum_version: '1.1.0', recommended_version: '1.2.0', update_url: 'https://apps.apple.com/app/id123',
                            allow_ahead_of_store: '1')
    assert_equal 302, last_response.status, last_response.body[0, 500]
    assert_match %r{/admin/admin_native_devices#app-versions\z}, last_response.location
    row = AppVersion.find_by!(platform: 'ios')
    assert_equal ['1.1.0', '1.2.0', 'https://apps.apple.com/app/id123', true],
                 [row.minimum_version, row.recommended_version, row.update_url, row.allow_ahead_of_store]
    follow_redirect!
    assert_includes last_response.body, 'iOS app versions saved.'
    assert_includes last_response.body, 'value="1.1.0"'
    assert_equal 1, last_response.body.scan('No versions set').size, 'Android still has none'
    assert_equal '1.1.0', app_version_json(platform: 'ios', version: '1.0.0')['minimum_version']

    save_app_version('android', minimum_version: '2.0.0', allow_ahead_of_store: '1')
    assert_equal 302, last_response.status
    refute AppVersion.find_by!(platform: 'android').allow_ahead_of_store, 'Android has no App Store box'

    save_app_version('ios', minimum_version: ' ', recommended_version: '', update_url: '')
    assert_equal 302, last_response.status
    refute AppVersion.exists?(platform: 'ios'), 'clearing both versions and the link deletes the row'
    follow_redirect!
    assert_includes last_response.body, 'iOS app versions cleared.'

    get '/admin/admin_native_devices'
    delete '/admin/admin_native_app_versions/android', authenticity_token: form_token('app-version-android-clear')
    assert_equal 302, last_response.status
    refute AppVersion.exists?(platform: 'android')
  ensure
    Warden.test_reset!
  end

  def test_admin_page_shows_errors_inline
    AppVersion.delete_all
    sign_in_to_admin(@admin)
    save_app_version('android', minimum_version: '1.2', recommended_version: '1.0.0', update_url: 'http://example.com')
    assert_equal 422, last_response.status
    form = last_response.body[/<form[^>]*id="app-version-android".*?<\/form>/m]
    assert_includes form, 'Minimum version must be a version like 1.2.3'
    assert_includes form, 'Update link must be an https link'
    assert_includes form, 'value="1.2"', 'keeps what was typed'
    assert_includes form, 'is-invalid'
    refute AppVersion.exists?(platform: 'android')

    with_gem_config(ios_bundle_id: 'com.example.admin') do
      stub_app_store(error: Net::ReadTimeout) do
        save_app_version('ios', minimum_version: '1.0.0')
        assert_equal 422, last_response.status
        form = last_response.body[/<form[^>]*id="app-version-ios".*?<\/form>/m]
        assert_includes form, 'Tick &quot;Allow ahead of the App Store&quot;'
      end
    end
  ensure
    Warden.test_reset!
  end

  def test_admin_page_refuses_non_admins
    AppVersion.delete_all
    shopper = Spree.user_class.create!(email: "shopper-#{SecureRandom.hex(4)}@example.com", password: 'secret123', password_confirmation: 'secret123')
    refute shopper.has_spree_role?(:admin)
    sign_in_to_admin(shopper)
    get '/admin/admin_native_devices'
    assert_equal 302, last_response.status
    refute_includes last_response.location, 'admin_native_devices'

    forgery = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = false
    patch '/admin/admin_native_app_versions/ios', app_version: { minimum_version: '1.0.0' }
    assert_equal 302, last_response.status
    refute AppVersion.exists?(platform: 'ios')
  ensure
    ActionController::Base.allow_forgery_protection = forgery unless forgery.nil?
    Warden.test_reset!
  end

  # --- 0.7: tree views ----------------------------------------------------------------------

  include ActiveSupport::Testing::TimeHelpers

  class SanMenu < ActiveRecord::Base
    self.table_name = 't7_menus'
  end

  class SanMenuItem < ActiveRecord::Base
    self.table_name = 't7_menu_items'
    default_scope { order(position: :asc) } # like dna-admin's MenuItem
  end

  # Tables made inside the test's transaction, so they roll back with it (Postgres DDL is
  # transactional). Registers t7_menus (hidden, the group) and t7_menu_items (a tree with a link).
  def with_menu_types(update: true, editable_if: nil)
    connection = ActiveRecord::Base.connection
    connection.create_table(:t7_menus) { |t| t.string :title }
    connection.create_table(:t7_menu_items) do |t|
      t.string :name, null: false
      t.string :url
      t.string :item_class
      t.string :item_id
      t.integer :parent_id
      t.integer :position, null: false, default: 0
      t.integer :menu_id
      t.timestamps
    end
    refresh_tables
    registry = SpreeAdminNative.resources
    registry.register('t7_menus') do |r|
      r.model SanMenu.name
      r.hidden
      r.title :title
      r.fields :auto
    end
    registry.register('t7_menu_items') do |r|
      r.model SanMenuItem.name
      r.title :name
      r.fields :auto
      r.field :menu_id, :reference, resource: 't7_menus', label: 'Menu'
      r.field :link, :link, url: :url, kind: :item_class, id: :item_id,
                            kinds: { 'product' => 'spree_products', 'taxon' => 'spree_taxons', 'page' => 't7_no_pages' }
      r.view :tree, parent: :parent_id, position: :position, group: :menu_id
      r.actions update: false unless update
      r.editable_if editable_if if editable_if
    end
    yield registry
  ensure
    %w[t7_menus t7_menu_items].each do |k|
      registry&.unregister(k)
      ActiveRecord::Base.connection.drop_table(k, if_exists: true)
    end
    refresh_tables
  end

  def refresh_tables
    %w[t7_menus t7_menu_items].each { |t| ActiveRecord::Base.connection.schema_cache.clear_data_source_cache!(t) }
    [SanMenu, SanMenuItem].each(&:reset_column_information)
  end

  # { name => [id, ...] } helpers over the tree JSON.
  def tree_names(nodes)
    nodes.map { |n| n['children'].any? ? { n['title'] => tree_names(n['children']) } : n['title'] }
  end

  def tree(key, group = nil)
    get "/api/admin_native/v1/resources/#{key}/tree", group ? { group: group } : {}
    assert_equal 200, last_response.status, last_response.body
    json
  end

  def move(key, group, nodes)
    patch "/api/admin_native/v1/resources/#{key}/tree", { group: group, nodes: nodes }.to_json, 'CONTENT_TYPE' => 'application/json'
    last_response.body.empty? ? {} : json
  end

  def menu_fixture
    main = SanMenu.create!(title: 'Main')
    footer = SanMenu.create!(title: 'Footer')
    item = ->(name, position, parent = nil, menu = main) { SanMenuItem.create!(name: name, position: position, parent_id: parent&.id, menu_id: menu.id) }
    shop = item.call('Shop', 0)
    about = item.call('About', 1)
    contact = item.call('Contact', 2)
    mugs = item.call('Mugs', 0, shop)
    cups = item.call('Cups', 1, shop)
    legal = item.call('Legal', 0, nil, footer)
    { main: main, footer: footer, shop: shop, about: about, contact: contact, mugs: mugs, cups: cups, legal: legal }
  end

  def positions(items)
    SanMenuItem.unscoped.where(id: items.map(&:id)).order(:position).map { |i| [i.name, i.parent_id, i.position] }
  end

  def test_tree_manifest_and_nested_get
    with_menu_types do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      manifest = manifest_of('t7_menu_items')
      assert_equal({ 'type' => 'tree', 'parent' => 'parent_id', 'position' => 'position', 'group' => 'menu_id' }, manifest['view'])
      assert_equal true, manifest_of('t7_menus')['hidden']
      refute manifest_of('t7_menus').key?('view')

      body = tree('t7_menu_items', m[:main].id)
      assert_equal [{ 'Shop' => %w[Mugs Cups] }, 'About', 'Contact'], tree_names(body['data'])
      assert_equal({ 'id' => m[:main].id.to_s, 'title' => 'Main' }, body.dig('meta', 'group'))
      node = body['data'].first
      assert_equal m[:shop].id.to_s, node['id']
      assert_equal({ 'id' => m[:main].id.to_s, 'title' => 'Main' }, node.dig('values', 'menu_id'))
      assert_equal({ 'update' => true, 'destroy' => true }, node['can'])
      assert_equal [], node['children'].first['children']

      whole = tree('t7_menu_items')
      assert_nil whole.dig('meta', 'group')
      assert_equal [{ 'Shop' => %w[Mugs Cups] }, 'Legal', 'About', 'Contact'], tree_names(whole['data']), 'every group, by position then id'

      get '/api/admin_native/v1/resources/t7_menu_items/tree', group: 999_999
      assert_equal 404, last_response.status
      get '/api/admin_native/v1/resources/t7_menus/tree'
      assert_equal 404, last_response.status, 'a type without a tree view'
      # The flat list and the record routes still work alongside the tree routes.
      resource_json(:get, "/t7_menu_items/#{m[:mugs].id}")
      assert_equal 200, last_response.status
    end
  end

  def test_tree_reorder_indent_and_outdent
    with_menu_types do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      before = SanMenuItem.unscoped.find(m[:about].id).updated_at

      body = move('t7_menu_items', m[:main].id, [{ id: m[:contact].id, parent_id: nil, position: 0 }])
      assert_equal 200, last_response.status, last_response.body
      assert_equal ['Contact', { 'Shop' => %w[Mugs Cups] }, 'About'], tree_names(body['data'])
      assert_equal [['Contact', nil, 0], ['Shop', nil, 1], ['About', nil, 2]], positions([m[:contact], m[:shop], m[:about]])
      assert_operator SanMenuItem.unscoped.find(m[:about].id).updated_at, :>, before, 'renumbered rows are touched'

      # Indent: About under Shop, between Mugs and Cups.
      body = move('t7_menu_items', m[:main].id, [{ id: m[:about].id, parent_id: m[:shop].id, position: 1 }])
      assert_equal ['Contact', { 'Shop' => %w[Mugs About Cups] }], tree_names(body['data'])

      # Outdent: Cups to the top level, last.
      body = move('t7_menu_items', m[:main].id, [{ id: m[:cups].id, parent_id: nil, position: 99 }])
      assert_equal ['Contact', { 'Shop' => %w[Mugs About] }, 'Cups'], tree_names(body['data'])
      assert_equal [['Contact', nil, 0], ['Shop', nil, 1], ['Cups', nil, 2]], positions([m[:contact], m[:shop], m[:cups]])
      assert_equal [['Mugs', m[:shop].id, 0], ['About', m[:shop].id, 1]], positions([m[:mugs], m[:about]])

      # Several moves at once, the way the app sends a whole renumbered level.
      body = move('t7_menu_items', m[:main].id, [{ id: m[:cups].id, parent_id: nil, position: 0 },
                                                 { id: m[:shop].id, parent_id: nil, position: 1 },
                                                 { id: m[:contact].id, parent_id: nil, position: 2 }])
      assert_equal ['Cups', { 'Shop' => %w[Mugs About] }, 'Contact'], tree_names(body['data'])
      assert_equal 'Legal', SanMenuItem.unscoped.find(m[:legal].id).name, 'the other menu is untouched'
      assert_equal 0, SanMenuItem.unscoped.find(m[:legal].id).position
    end
  end

  def test_tree_refuses_cycles_other_groups_and_switched_off_updates
    with_menu_types do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      snapshot = -> { SanMenuItem.unscoped.order(:id).pluck(:id, :parent_id, :position) }
      before = snapshot.call

      move('t7_menu_items', m[:main].id, [{ id: m[:shop].id, parent_id: m[:mugs].id, position: 0 }])
      assert_equal [422, 'cycle'], [last_response.status, json.dig('error', 'code')]
      move('t7_menu_items', m[:main].id, [{ id: m[:shop].id, parent_id: m[:shop].id, position: 0 }])
      assert_equal [422, 'cycle'], [last_response.status, json.dig('error', 'code')]
      # A cycle through two moves in one request.
      move('t7_menu_items', m[:main].id, [{ id: m[:about].id, parent_id: m[:contact].id, position: 0 },
                                          { id: m[:contact].id, parent_id: m[:about].id, position: 0 }])
      assert_equal [422, 'cycle'], [last_response.status, json.dig('error', 'code')]

      move('t7_menu_items', m[:main].id, [{ id: m[:legal].id, parent_id: nil, position: 0 }])
      assert_equal [422, 'outside_group'], [last_response.status, json.dig('error', 'code')]
      move('t7_menu_items', m[:main].id, [{ id: m[:about].id, parent_id: m[:legal].id, position: 0 }])
      assert_equal [422, 'outside_group'], [last_response.status, json.dig('error', 'code')]
      move('t7_menu_items', nil, [{ id: m[:about].id, parent_id: m[:legal].id, position: 0 }])
      assert_equal [422, 'outside_group'], [last_response.status, json.dig('error', 'code')], 'without a group, parents stay in their group'
      move('t7_menu_items', m[:main].id, [{ id: 0, parent_id: nil, position: 0 }])
      assert_equal [422, 'outside_group'], [last_response.status, json.dig('error', 'code')]

      move('t7_menu_items', m[:main].id, [{ id: m[:about].id, parent_id: nil, position: 'first' }])
      assert_equal [422, 'invalid'], [last_response.status, json.dig('error', 'code')]
      move('t7_menu_items', m[:main].id, [{ id: m[:about].id }, { id: m[:about].id }])
      assert_equal [422, 'invalid'], [last_response.status, json.dig('error', 'code')]
      patch '/api/admin_native/v1/resources/t7_menu_items/tree', { nodes: { id: 1 } }.to_json, 'CONTENT_TYPE' => 'application/json'
      assert_equal 422, last_response.status
      assert_equal before, snapshot.call
    end

    with_menu_types(update: false) do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      move('t7_menu_items', m[:main].id, [{ id: m[:about].id, parent_id: nil, position: 0 }])
      assert_equal [403, 'not_allowed'], [last_response.status, json.dig('error', 'code')]
    end

    with_menu_types(editable_if: ->(item) { item.name != 'About' }) do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      move('t7_menu_items', m[:main].id, [{ id: m[:contact].id, parent_id: nil, position: 0 },
                                          { id: m[:about].id, parent_id: nil, position: 0 }])
      assert_equal [403, 'not_allowed'], [last_response.status, json.dig('error', 'code')]
      assert_equal 2, SanMenuItem.unscoped.find(m[:contact].id).position, 'nothing applied'
      move('t7_menu_items', m[:main].id, [{ id: m[:contact].id, parent_id: nil, position: 0 }])
      assert_equal 200, last_response.status, 'a refused node only blocks moves of that node'
    end
  end

  def test_tree_renumbers_positions_per_parent
    with_menu_types do
      m = menu_fixture
      SanMenuItem.unscoped.where(id: m[:shop].id).update_all(position: 7)
      SanMenuItem.unscoped.where(id: m[:about].id).update_all(position: 7)
      SanMenuItem.unscoped.where(id: m[:contact].id).update_all(position: 30)
      SanMenuItem.unscoped.where(id: [m[:mugs].id, m[:cups].id]).update_all(position: 4)
      header 'X-Spree-Token', pair!
      body = move('t7_menu_items', m[:main].id, [])
      assert_equal 200, last_response.status, last_response.body
      assert_equal [{ 'Shop' => %w[Mugs Cups] }, 'About', 'Contact'], tree_names(body['data']), 'ties keep id order'
      assert_equal [['Shop', nil, 0], ['About', nil, 1], ['Contact', nil, 2]], positions([m[:shop], m[:about], m[:contact]])
      assert_equal [['Mugs', m[:shop].id, 0], ['Cups', m[:shop].id, 1]], positions([m[:mugs], m[:cups]])
      body['data'].each_with_index { |n, i| assert_equal i, n.dig('values', 'position') }

      # Gaps and a position past the end.
      body = move('t7_menu_items', m[:main].id, [{ id: m[:shop].id, parent_id: nil, position: 10 },
                                                 { id: m[:about].id, parent_id: nil, position: 3 }])
      assert_equal ['Contact', 'About', { 'Shop' => %w[Mugs Cups] }], tree_names(body['data'])
      assert_equal [0, 1, 2], body['data'].map { |n| n.dig('values', 'position') }
    end
  end

  def test_tree_is_capped
    assert_equal 2000, SpreeAdminNative::Tree::MAX_NODES
    with_menu_types do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      original = SpreeAdminNative::Tree::MAX_NODES
      SpreeAdminNative::Tree.send(:remove_const, :MAX_NODES)
      SpreeAdminNative::Tree.const_set(:MAX_NODES, 4)
      get '/api/admin_native/v1/resources/t7_menu_items/tree', group: m[:main].id
      assert_equal [422, 'too_large'], [last_response.status, json.dig('error', 'code')]
      move('t7_menu_items', m[:main].id, [])
      assert_equal [422, 'too_large'], [last_response.status, json.dig('error', 'code')]
      tree('t7_menu_items', m[:footer].id)
    ensure
      if original
        SpreeAdminNative::Tree.send(:remove_const, :MAX_NODES)
        SpreeAdminNative::Tree.const_set(:MAX_NODES, original)
      end
    end
  end

  def with_taxon_tree
    registry = SpreeAdminNative.resources
    registry.register('t7_taxonomies') do |r|
      r.model 'Spree::Taxonomy'
      r.hidden
      r.title :name
    end
    registry.register('t7_taxons') do |r|
      r.model 'Spree::Taxon'
      r.title :name
      r.field :name, :string
      r.field :taxonomy_id, :reference, resource: 't7_taxonomies'
      r.view :tree, parent: :parent_id, position: :position, group: :taxonomy_id
    end
    yield
  ensure
    %w[t7_taxonomies t7_taxons].each { |k| registry.unregister(k) }
  end

  # Spree::Taxon is an awesome_nested_set: lft / rgt / depth must stay valid after moves.
  def test_tree_keeps_a_nested_set_valid
    with_taxon_tree do
      taxonomy = Spree::Taxonomy.create!(name: 'T7 Menu')
      root = taxonomy.root || Spree::Taxon.create!(name: 'T7 Menu', taxonomy: taxonomy)
      add = ->(name, parent) { Spree::Taxon.create!(name: name, taxonomy: taxonomy, parent: parent) }
      a = add.call('A', root)
      b = add.call('B', root)
      c = add.call('C', root)
      a1 = add.call('A1', a)
      others = Spree::Taxon.where.not(taxonomy_id: taxonomy.id).order(:id).pluck(:id, :lft, :rgt, :depth)
      header 'X-Spree-Token', pair!
      body = tree('t7_taxons', taxonomy.id)
      assert_equal [{ 'T7 Menu' => [{ 'A' => ['A1'] }, 'B', 'C'] }], tree_names(body['data'])

      move('t7_taxons', taxonomy.id, [{ id: c.id, parent_id: root.id, position: 0 }])
      assert_equal 200, last_response.status, last_response.body
      move('t7_taxons', taxonomy.id, [{ id: b.id, parent_id: a.id, position: 0 }])
      body = move('t7_taxons', taxonomy.id, [{ id: a1.id, parent_id: root.id, position: 1 }])
      assert_equal [{ 'T7 Menu' => ['C', 'A1', { 'A' => ['B'] }] }], tree_names(body['data'])

      assert Spree::Taxon.valid?, 'lft / rgt are a valid nested set'
      assert_equal %w[C A1 A], root.reload.children.map(&:name), "awesome_nested_set's own order agrees"
      assert_equal %w[B], a.reload.children.map(&:name)
      assert_equal [2, 1], [b.reload.depth, a1.reload.depth]
      assert_equal others, Spree::Taxon.where.not(taxonomy_id: taxonomy.id).order(:id).pluck(:id, :lft, :rgt, :depth)

      other = Spree::Taxon.where.not(taxonomy_id: taxonomy.id).first
      move('t7_taxons', taxonomy.id, [{ id: other.id, parent_id: root.id, position: 0 }])
      assert_equal [422, 'outside_group'], [last_response.status, json.dig('error', 'code')], 'a node from another taxonomy'
    end
  end

  # --- 0.7: link fields ---------------------------------------------------------------------

  def test_link_fields_read_and_write_each_kind
    with_menu_types do
      m = menu_fixture
      header 'X-Spree-Token', pair!
      manifest = manifest_of('t7_menu_items')
      link = manifest['fields'].find { |f| f['name'] == 'link' }
      assert_equal 'link', link['type']
      assert_equal %w[url product taxon], link['options'], 'kinds whose type is missing are left out'
      assert_equal [{ 'kind' => 'url' }, { 'kind' => 'product', 'resource' => 'spree_products' },
                    { 'kind' => 'taxon', 'resource' => 'spree_taxons' }], link['kinds']
      names = manifest['fields'].map { |f| f['name'] }
      %w[url item_class item_id].each { |n| refute_includes names, n, 'the link replaces its columns' }

      path = "/t7_menu_items/#{m[:about].id}"
      assert_nil resource_json(:get, path).dig('data', 'values', 'link')

      body = resource_json(:patch, path, values: { link: { kind: 'url', url: 'https://example.com/about' } })
      assert_equal 200, last_response.status, last_response.body
      assert_equal({ 'kind' => 'url', 'url' => 'https://example.com/about' }, body.dig('data', 'values', 'link'))
      assert_equal ['https://example.com/about', 'url', nil], SanMenuItem.unscoped.find(m[:about].id).then { |i| [i.url, i.item_class, i.item_id] }

      product = Spree::Product.first
      body = resource_json(:patch, path, values: { link: { kind: 'product', id: product.id } })
      assert_equal({ 'kind' => 'product', 'id' => product.id.to_s, 'title' => product.name }, body.dig('data', 'values', 'link'))
      assert_equal [nil, 'product', product.id.to_s], SanMenuItem.unscoped.find(m[:about].id).then { |i| [i.url, i.item_class, i.item_id] }

      taxon = Spree::Taxon.where.not(parent_id: nil).first
      body = resource_json(:patch, path, values: { link: { kind: 'taxon', id: { id: taxon.id.to_s, title: 'ignored' } } })
      assert_equal({ 'kind' => 'taxon', 'id' => taxon.id.to_s, 'title' => taxon.pretty_name }, body.dig('data', 'values', 'link'))
      list = resource_json(:get, '/t7_menu_items?per_page=100')['data'].find { |r| r['id'] == m[:about].id.to_s }
      assert_equal taxon.pretty_name, list.dig('values', 'link', 'title'), 'titles in lists too'
      assert_equal taxon.pretty_name, tree('t7_menu_items', m[:main].id)['data'].find { |n| n['title'] == 'About' }.dig('values', 'link', 'title')

      body = resource_json(:patch, path, values: { link: nil })
      assert_nil body.dig('data', 'values', 'link')
      assert_equal [nil, nil, nil], SanMenuItem.unscoped.find(m[:about].id).then { |i| [i.url, i.item_class, i.item_id] }

      # A legacy value: an unknown kind with a URL reads as a URL.
      SanMenuItem.unscoped.where(id: m[:about].id).update_all(url: '/legacy', item_class: 'menu-highlight')
      assert_equal({ 'kind' => 'url', 'url' => '/legacy' }, resource_json(:get, path).dig('data', 'values', 'link'))

      [[{ kind: 'page', id: 1 }, 'kind must be one of url, product, taxon'], [{ kind: 'product', id: 0 }, "links to a product that doesn't exist"],
       [{ kind: 'product' }, 'needs a product'], [{ kind: 'url', url: ' ' }, 'needs a URL'], ['https://example.com', 'is not a valid link']].each do |value, message|
        resource_json(:patch, path, values: { link: value })
        assert_equal 422, last_response.status, value.inspect
        assert_equal [message], json.dig('error', 'fields', 'link'), value.inspect
      end

      created = resource_json(:post, '/t7_menu_items', values: { name: 'Sale', menu_id: m[:main].id, link: { kind: 'product', id: product.id } })
      assert_equal 201, last_response.status, last_response.body
      assert_equal 'product', created.dig('data', 'values', 'link', 'kind')
    end
  end

  # --- 0.7: inbox ---------------------------------------------------------------------------

  # An in-memory inbox. `broken` makes one method return bad data or raise.
  class StubInbox < SpreeAdminNative::Inbox::Adapter
    attr_accessor :calls, :broken, :up

    def initialize
      super
      @calls = []
      @up = true
      now = Time.utc(2026, 11, 28, 10, 0, 0)
      @conversation = {
        id: 12, status: 'open', channel: 'web', subject: nil,
        customer: { name: 'Ada', email: 'ada@example.com', avatar_url: nil, contact_id: 7, user_id: 3 },
        assignee: { id: 1, email: 'staff@example.com' }, unread: 2,
        last_message: { body: 'Is this in stock?', direction: 'inbound', at: now },
        updated_at: now, snoozed_until: nil
      }
      @messages = (1..3).map do |i|
        { 'id' => 300 + i, 'direction' => i == 3 ? 'note' : 'inbound', 'body' => "Message #{i}", 'channel' => 'web',
          'author' => { 'kind' => i == 3 ? 'staff' : 'customer', 'name' => i == 3 ? 'Staff' : 'Ada' },
          'attachments' => i == 2 ? [{ 'url' => 'https://example.com/a.png', 'filename' => 'a.png', 'content_type' => 'image/png' }] : [],
          'created_at' => (now + i).iso8601, 'read_at' => nil, 'delivery' => nil }
      end
    end

    def available?
      raise 'down' if up == :raise

      up
    end

    def conversations(filters)
      log(:conversations, filters)
      return { records: 'nope', total: 1 } if broken == :records
      return { records: [@conversation.merge(status: nil)], total: 1 } if broken == :conversation

      { records: [@conversation], total: 1 }
    end

    def conversation(id)
      log(:conversation, id)
      raise 'database on fire' if broken == :raise

      id.to_s == '12' ? @conversation : nil
    end

    def messages(conversation, before:, after:, limit:)
      log(:messages, conversation[:id], before: before, after: after, limit: limit)
      return [@messages.first.merge('direction' => 'sideways')] if broken == :message

      @messages
    end

    def reply(conversation, admin, body:, attachments:, note:)
      log(:reply, conversation[:id], admin.id, body: body, attachments: attachments, note: note)
      { id: 400, direction: note ? 'note' : 'outbound', body: body, channel: 'web', author: { kind: 'staff', name: admin.email },
        attachments: [], created_at: Time.current, read_at: nil, delivery: note ? nil : 'sent' }
    end

    def update(conversation, admin, attrs)
      log(:update, conversation[:id], admin.id, attrs)
      raise SpreeAdminNative::AdapterInvalid, 'No such staff member.' if attrs[:assignee_id] == '404'

      @conversation.merge(attrs.slice(:status, :snoozed_until))
    end

    def mark_read(conversation, admin)
      log(:mark_read, conversation[:id], admin.id)
      @conversation.merge(unread: 0)
    end

    def summary(admin)
      log(:summary, admin.id)
      return { open: 4, unassigned: 1 } if broken == :summary

      { 'open' => 4, 'unassigned' => 1, 'unread' => 2 }
    end

    def customer_context(conversation)
      log(:customer_context, conversation[:id])
      {
        contact: { id: 7, name: 'Ada', email: 'ada@example.com', phone: nil },
        user: { id: 3, email: 'ada@example.com' },
        session: { id: 55, current_url: '/products/mug', last_seen_at: Time.current - 30 },
        cart: { order_number: 'R123', item_count: 2, total: BigDecimal('18.5'), currency: 'USD',
                items: [{ name: 'Mug', quantity: 2, image_url: nil }] },
        recent_orders: [{ number: 'R100', state: 'complete', total: 42, completed_at: Time.utc(2026, 11, 1) }]
      }
    end

    private

    def log(*call)
      calls << call
    end
  end

  # Implements nothing: every call raises NotImplementedError.
  class EmptyInbox < SpreeAdminNative::Inbox::Adapter; end

  def with_inbox(adapter = StubInbox.new, store: ActiveSupport::Cache::MemoryStore.new)
    with_gem_config(inbox_adapter: adapter, cache_store: store) { yield adapter }
  end

  def inbox(method, path, body = nil)
    send(method, "/api/admin_native/v1/inbox#{path}", body&.to_json, 'CONTENT_TYPE' => 'application/json')
    last_response.body.empty? ? {} : json
  end

  def test_inbox_capability_follows_the_adapter
    with_gem_config(inbox_adapter: nil) do
      get '/api/admin_native/v1/capabilities'
      refute_includes json['capabilities'], 'inbox'
      header 'X-Spree-Token', pair!
      inbox(:get, '/conversations')
      assert_equal [404, 'unsupported'], [last_response.status, json.dig('error', 'code')]
    end
    with_inbox do |adapter|
      get '/api/admin_native/v1/capabilities'
      assert_includes json['capabilities'], 'inbox'
      adapter.up = false
      get '/api/admin_native/v1/capabilities'
      refute_includes json['capabilities'], 'inbox'
      inbox(:get, '/summary')
      assert_equal 404, last_response.status
      adapter.up = :raise
      get '/api/admin_native/v1/capabilities'
      refute_includes json['capabilities'], 'inbox'
    end
    with_inbox(StubInbox.name) do
      get '/api/admin_native/v1/capabilities'
      assert_includes json['capabilities'], 'inbox', 'a class name works too'
    end
  end

  def test_inbox_needs_an_admin
    with_inbox do
      %w[/conversations /conversations/12 /conversations/12/messages /summary].each do |path|
        inbox(:get, path)
        assert_equal 401, last_response.status, path
      end
      inbox(:post, '/conversations/12/messages', body: 'Hi')
      assert_equal 401, last_response.status
    end
  end

  def test_inbox_lists_conversations_with_filters
    with_inbox do |adapter|
      header 'X-Spree-Token', pair!
      body = inbox(:get, '/conversations')
      assert_equal 200, last_response.status, last_response.body
      filters = adapter.calls.last.last
      assert_equal ['open', 'any', nil, 1, 25, nil, @admin.id],
                   [filters[:status], filters[:assignee], filters[:q], filters[:page], filters[:per_page], filters[:updated_since], filters[:admin].id]
      assert_equal({ 'page' => 1, 'per_page' => 25, 'total_count' => 1 }, body['meta'])
      assert_equal({
                     'id' => '12', 'status' => 'open', 'channel' => 'web', 'subject' => nil,
                     'customer' => { 'name' => 'Ada', 'email' => 'ada@example.com', 'avatar_url' => nil, 'contact_id' => '7', 'user_id' => '3' },
                     'assignee' => { 'id' => '1', 'email' => 'staff@example.com' }, 'unread' => 2,
                     'last_message' => { 'body' => 'Is this in stock?', 'direction' => 'inbound', 'at' => '2026-11-28T10:00:00Z' },
                     'updated_at' => '2026-11-28T10:00:00Z', 'snoozed_until' => nil
                   }, body['data'].first)

      inbox(:get, '/conversations?status=all&assignee=me&q=ada&page=2&per_page=500&updated_since=2026-11-28T09:00:00Z')
      filters = adapter.calls.last.last
      assert_equal ['all', 'me', 'ada', 2, 100], filters.values_at(:status, :assignee, :q, :page, :per_page)
      assert_equal Time.utc(2026, 11, 28, 9), filters[:updated_since]

      inbox(:get, '/conversations?status=spam')
      assert_equal [422, ['must be one of open, snoozed, closed, all']], [last_response.status, json.dig('error', 'fields', 'status')]
      inbox(:get, '/conversations?assignee=you')
      assert_equal 422, last_response.status
      inbox(:get, '/conversations?updated_since=yesterday')
      assert_equal [422, ['must be an ISO 8601 time']], [last_response.status, json.dig('error', 'fields', 'updated_since')]
    end
  end

  def test_inbox_conversation_with_customer_context_and_messages
    with_inbox do |adapter|
      header 'X-Spree-Token', pair!
      body = inbox(:get, '/conversations/12')
      assert_equal 200, last_response.status, last_response.body
      assert_equal '12', body.dig('data', 'id')
      context = body.dig('data', 'customer_context')
      assert_equal({ 'id' => '7', 'name' => 'Ada', 'email' => 'ada@example.com', 'phone' => nil }, context['contact'])
      assert_equal({ 'id' => '3', 'email' => 'ada@example.com' }, context['user'])
      assert_equal ['55', '/products/mug', true], context['session'].values_at('id', 'current_url', 'online')
      assert_equal({ 'order_number' => 'R123', 'item_count' => 2, 'total' => '18.50', 'currency' => 'USD',
                     'items' => [{ 'name' => 'Mug', 'quantity' => 2, 'image_url' => nil }] }, context['cart'])
      assert_equal [{ 'number' => 'R100', 'state' => 'complete', 'total' => '42.00', 'completed_at' => '2026-11-01T00:00:00Z' }], context['recent_orders']

      inbox(:get, '/conversations/99')
      assert_equal [404, 'not_found'], [last_response.status, json.dig('error', 'code')]

      body = inbox(:get, '/conversations/12/messages')
      assert_equal [:messages, 12, { before: nil, after: nil, limit: 50 }], adapter.calls.last
      assert_equal %w[301 302 303], body['data'].map { |m| m['id'] }
      assert_equal({ 'id' => '302', 'direction' => 'inbound', 'body' => 'Message 2', 'channel' => 'web',
                     'author' => { 'kind' => 'customer', 'name' => 'Ada' },
                     'attachments' => [{ 'url' => 'https://example.com/a.png', 'filename' => 'a.png', 'content_type' => 'image/png' }],
                     'created_at' => '2026-11-28T10:00:02Z', 'read_at' => nil, 'delivery' => nil }, body['data'][1])
      assert_equal 'note', body['data'][2]['direction']

      body = inbox(:get, '/conversations/12/messages?before=303&limit=2')
      assert_equal [:messages, 12, { before: '303', after: nil, limit: 2 }], adapter.calls.last
      assert_equal %w[302 303], body['data'].map { |m| m['id'] }, 'more than the limit keeps the newest'
      body = inbox(:get, '/conversations/12/messages?after=300&limit=500')
      assert_equal [:messages, 12, { before: nil, after: '300', limit: 200 }], adapter.calls.last
      assert_equal 200, body.dig('meta', 'limit')
    end
  end

  def test_inbox_reply_note_update_read_and_summary
    with_inbox do |adapter|
      header 'X-Spree-Token', pair!
      body = inbox(:post, '/conversations/12/messages', body: '  In stock, yes.  ')
      assert_equal 201, last_response.status, last_response.body
      assert_equal [:reply, 12, @admin.id, { body: 'In stock, yes.', attachments: [], note: false }], adapter.calls.last
      assert_equal ['outbound', 'sent', 'staff'], [body.dig('data', 'direction'), body.dig('data', 'delivery'), body.dig('data', 'author', 'kind')]

      inbox(:post, '/conversations/12/messages', body: 'VIP', note: true)
      assert_equal true, adapter.calls.last.last[:note]
      assert_equal 'note', json.dig('data', 'direction')

      blob = upload(StringIO.new(png), 'photo.png', 'image/png').dig('data', 'signed_id')
      inbox(:post, '/conversations/12/messages', attachments: [blob])
      assert_equal 201, last_response.status, last_response.body
      assert_equal [blob], adapter.calls.last.last[:attachments]

      inbox(:post, '/conversations/12/messages', body: ' ')
      assert_equal [422, ["can't be blank"]], [last_response.status, json.dig('error', 'fields', 'body')]
      inbox(:post, '/conversations/12/messages', body: 'x' * 4001)
      assert_equal 422, last_response.status
      inbox(:post, '/conversations/12/messages', body: 'Look', attachments: ['forged'])
      assert_equal [422, ['is not a valid upload']], [last_response.status, json.dig('error', 'fields', 'attachments')]
      inbox(:post, '/conversations/99/messages', body: 'Hi')
      assert_equal 404, last_response.status

      body = inbox(:patch, '/conversations/12', status: 'snoozed', snoozed_until: '2026-11-29T09:00:00Z', assignee_id: 1)
      assert_equal 200, last_response.status, last_response.body
      attrs = adapter.calls.last.last
      assert_equal ['snoozed', '1', Time.utc(2026, 11, 29, 9)], attrs.values_at(:status, :assignee_id, :snoozed_until)
      assert_equal ['snoozed', '2026-11-29T09:00:00Z'], body['data'].values_at('status', 'snoozed_until')
      inbox(:patch, '/conversations/12', assignee_id: nil, snoozed_until: nil)
      assert_equal({ assignee_id: nil, snoozed_until: nil }, adapter.calls.last.last, 'only the keys sent')
      inbox(:patch, '/conversations/12', assignee_id: 'me')
      assert_equal({ assignee_id: @admin.id.to_s }, adapter.calls.last.last, "'me' is the signed-in admin")
      inbox(:patch, '/conversations/12', status: 'deleted')
      assert_equal 422, last_response.status
      inbox(:patch, '/conversations/12', snoozed_until: 'tomorrow')
      assert_equal 422, last_response.status
      inbox(:patch, '/conversations/12', assignee_id: 404)
      assert_equal [422, 'invalid', 'No such staff member.'], [last_response.status, json.dig('error', 'code'), json.dig('error', 'message')]

      body = inbox(:post, '/conversations/12/read')
      assert_equal [200, 0], [last_response.status, body.dig('data', 'unread')]
      assert_equal [:mark_read, 12, @admin.id], adapter.calls.last

      body = inbox(:get, '/summary')
      assert_equal({ 'open' => 4, 'unassigned' => 1, 'unread' => 2, 'me' => { 'id' => @admin.id.to_s, 'email' => @admin.email } }, body['data'])
      assert_equal [4, 1, 2], body.values_at('open', 'unassigned', 'unread')
    end
  end

  def test_inbox_validates_adapter_output_and_reports_failures
    with_inbox do |adapter|
      header 'X-Spree-Token', pair!
      { records: '/conversations', conversation: '/conversations', message: '/conversations/12/messages', summary: '/summary' }.each do |mode, path|
        adapter.broken = mode
        inbox(:get, path)
        assert_equal [502, 'adapter_failed'], [last_response.status, json.dig('error', 'code')], mode.to_s
      end
      adapter.broken = :summary
      inbox(:get, '/summary')
      assert_equal "The store's inbox summary is missing unread.", json.dig('error', 'message')
      adapter.broken = :raise
      inbox(:get, '/conversations/12')
      assert_equal 502, last_response.status
      refute_includes last_response.body, 'database on fire'
      refute_includes last_response.body, '.rb:', 'no stack trace'
    end
    with_inbox(EmptyInbox.new) do
      get '/api/admin_native/v1/capabilities'
      assert_includes json['capabilities'], 'inbox', 'available? is true by default'
      header 'X-Spree-Token', pair!
      inbox(:get, '/summary')
      assert_equal [502, 'adapter_failed'], [last_response.status, json.dig('error', 'code')], 'NotImplementedError'
      inbox(:get, '/conversations/1')
      assert_equal 502, last_response.status
    end
  end

  # Records ExpoPush deliveries instead of sending them.
  def capture_pushes
    sent = []
    adapter = SpreeAdminNative::PushJob.queue_adapter
    SpreeAdminNative::PushJob.queue_adapter = :inline
    SpreeAdminNative::ExpoPush.class_eval do
      alias_method :__san_deliver, :deliver
      define_method(:deliver) do |devices, title:, body:, data: {}|
        sent << { devices: devices.to_a.map(&:id), title: title, body: body, data: data }
        devices.to_a.size
      end
    end
    yield sent
  ensure
    SpreeAdminNative::PushJob.queue_adapter = adapter if adapter
    SpreeAdminNative::ExpoPush.class_eval do
      alias_method :deliver, :__san_deliver
      remove_method :__san_deliver
    end
  end

  def test_inbound_messages_push_once_per_conversation_per_two_minutes
    SpreeAdminNative::Device.update_all(push_token: nil)
    device, = SpreeAdminNative::Device.issue!(owner: @admin, name: 'Inbox phone')
    device.update!(push_token: 'ExponentPushToken[inbox]')
    conversation = { 'id' => 12, 'customer' => { 'name' => 'Ada', 'email' => 'ada@example.com' } }
    with_inbox do
      capture_pushes do |sent|
        long = "Is this in stock? #{'Really. ' * 30}"
        assert SpreeAdminNative::Inbox.notify_inbound(conversation, { body: long, direction: 'inbound' })
        assert_equal 1, sent.size
        push = sent.first
        assert_equal [[device.id], 'Ada'], [push[:devices], push[:title]]
        assert_equal 140, push[:body].length
        assert push[:body].end_with?('…')
        assert_equal({ 'type' => 'inbox', 'conversation_id' => '12' }, push[:data])

        refute SpreeAdminNative::Inbox.notify_inbound(conversation, { body: 'Hello?' }), 'throttled'
        assert SpreeAdminNative::Inbox.notify_inbound({ id: 13, customer: { email: 'bo@example.com' } }, { body: 'Hi' })
        assert_equal ['bo@example.com', 'Hi'], [sent.last[:title], sent.last[:body]], 'the email when there is no name'
        refute SpreeAdminNative::Inbox.notify_inbound({ id: 14 }, { body: 'Reply', direction: 'outbound' }), 'only inbound'
        refute SpreeAdminNative::Inbox.notify_inbound({ customer: {} }, { body: 'No id' }), 'never raises'
        assert_equal 2, sent.size

        travel 121.seconds do
          assert SpreeAdminNative::Inbox.notify_inbound(conversation, { body: 'Still there?' })
        end
        assert_equal 3, sent.size
      end
    end
  end

  # --- 0.7: carts ---------------------------------------------------------------------------

  def make_cart(email:, state: 'cart', updated: Time.current, items: 1, created_by: nil, user: nil, complete: false)
    order = Spree::Order.create!(email: email, store: Spree::Store.default, created_by: created_by, user: user, currency: 'USD')
    variant = Spree::Variant.where(is_master: false).first
    Spree::Cart::AddItem.call(order: order, variant: variant, quantity: items) if items.positive?
    order.update_columns(state: state, updated_at: updated, email: email) # Spree copies a user's email in
    order.update_columns(completed_at: Time.current, state: 'complete') if complete
    order
  end

  def carts(params = {})
    get '/api/admin_native/v1/carts', { per_page: 100 }.merge(params)
    assert_equal 200, last_response.status, last_response.body
    json
  end

  def test_carts_list_shoppers_carts_with_items
    get '/api/admin_native/v1/carts'
    assert_equal 401, last_response.status

    shopper = Spree.user_class.where.not(id: @admin.id).detect { |u| !u.has_spree_role?(:admin) }
    fresh = make_cart(email: 'fresh@example.com', items: 2, user: shopper, created_by: shopper)
    guest = make_cart(email: nil, state: 'address', updated: 10.minutes.ago)
    old = make_cart(email: 'old@example.com', state: 'payment', updated: 2.hours.ago)
    delivery = make_cart(email: 'ship@example.com', state: 'delivery', updated: 30.minutes.ago)
    empty = make_cart(email: 'empty@example.com', items: 0)
    confirm = make_cart(email: 'confirm@example.com', state: 'confirm')
    placed = make_cart(email: 'placed@example.com', complete: true)
    draft = make_cart(email: 'draft@example.com', created_by: @admin)
    own = make_cart(email: @admin.email, created_by: @admin, user: @admin)

    header 'X-Spree-Token', pair!
    body = carts
    numbers = body['data'].map { |c| c['number'] }
    mine = [own, fresh, guest, delivery, old].map(&:number)
    assert_equal mine, numbers.select { |n| mine.include?(n) }, 'newest activity first'
    [empty, confirm, placed, draft].each { |o| refute_includes numbers, o.number }
    assert_operator body.dig('meta', 'total_count'), :>=, 5

    cart = body['data'].find { |c| c['number'] == fresh.number }
    variant = fresh.line_items.first.variant
    assert_equal({ 'number' => fresh.number, 'state' => 'cart', 'email' => 'fresh@example.com', 'user_id' => shopper.id.to_s,
                   'item_count' => 2, 'total' => format('%.2f', fresh.reload.total), 'currency' => 'USD',
                   'updated_at' => fresh.updated_at.iso8601, 'abandoned' => false,
                   'items' => [{ 'name' => variant.product.name, 'variant_sku' => variant.sku.presence, 'quantity' => 2,
                                 'image_url' => cart['items'].first['image_url'] }] }, cart)
    assert_equal true, body['data'].find { |c| c['number'] == old.number }['abandoned']
    assert_nil body['data'].find { |c| c['number'] == guest.number }['email']
  end

  def test_carts_filters_and_detail
    fresh = make_cart(email: 'fresh@example.com')
    guest = make_cart(email: nil, state: 'address', updated: 10.minutes.ago)
    old = make_cart(email: 'old@example.com', state: 'payment', updated: 2.hours.ago)
    old_guest = make_cart(email: nil, updated: 3.hours.ago)
    header 'X-Spree-Token', pair!
    pick = ->(body) { body['data'].map { |c| c['number'] } & [fresh, guest, old, old_guest].map(&:number) }

    assert_equal [fresh, guest].map(&:number), pick.call(carts(active_within: 60))
    assert_equal [fresh, old].map(&:number), pick.call(carts(with_email: true))
    assert_equal [guest, old_guest].map(&:number), pick.call(carts(with_email: false))
    assert_equal [old].map(&:number), pick.call(carts(abandoned: true))
    assert_equal [fresh, guest, old_guest].map(&:number), pick.call(carts(abandoned: false))
    assert_equal [fresh].map(&:number), pick.call(carts(active_within: 5, with_email: true))
    get '/api/admin_native/v1/carts', active_within: 0
    assert_equal 422, last_response.status

    get "/api/admin_native/v1/carts/#{old.number}"
    assert_equal 200, last_response.status, last_response.body
    assert_equal [old.number, 'payment', 1], json['data'].values_at('number', 'state', 'item_count')
    assert_equal 1, json.dig('data', 'items').size
    add_image(old.line_items.first.variant, alt: 'Cart photo')
    get "/api/admin_native/v1/carts/#{old.number}"
    assert_match(%r{\Ahttp://localhost/rails/active_storage/.+test\.png\z}, json.dig('data', 'items', 0, 'image_url'))
    get "/api/admin_native/v1/carts/#{Spree::Order.complete.first.number}"
    assert_equal 404, last_response.status
  end

  # --- 0.7: visitors ------------------------------------------------------------------------

  class StubVisitors < SpreeAdminNative::Visitors::Adapter
    attr_accessor :calls, :broken

    def initialize
      super
      @calls = []
    end

    def sessions(filters)
      calls << [:sessions, filters]
      return { records: [{ id: 1 }], total: 1 } if broken

      online = session_hash(55, Time.current - 30)
      away = session_hash(56, Time.current - 600).merge(contact: nil, utm: nil, cart: nil, device: 'fridge', conversation_id: nil)
      records = filters[:online] == true ? [online] : [online, away]
      { records: records, total: records.size }
    end

    def session(id)
      calls << [:session, id]
      return nil unless %w[55 56].include?(id)

      pages = (1..60).map { |i| { url: "/p/#{i}", title: "Page #{i}", at: Time.utc(2026, 11, 28, 9) + (i * 60) } }
      session_hash(id.to_i, Time.current - 30).merge(pages: pages.shuffle(random: Random.new(1)))
    end

    def start_conversation(session, admin)
      calls << [:start_conversation, session[:id], admin.id]
      session[:id] == 56 ? 77 : { conversation_id: 12 }
    end

    def session_hash(id, seen)
      { id: id, contact: { id: 7, name: 'Ada', email: 'ada@example.com' }, user_id: 3, current_url: '/products/mug',
        current_title: 'Mug', referrer: 'https://search.example.com', utm: { source: 'news', medium: 'email', campaign: 'fall' },
        device: 'mobile', country: 'NL', started_at: seen - 300, last_seen_at: seen, page_views: 4,
        cart: { order_number: 'R123', item_count: 2, total: '18.50', currency: 'USD' }, conversation_id: 12 }
    end
  end

  def test_visitors_endpoints_over_an_adapter
    with_gem_config(visitors_adapter: nil) do
      get '/api/admin_native/v1/capabilities'
      refute_includes json['capabilities'], 'visitors'
      assert_includes json['capabilities'], 'carts'
      header 'X-Spree-Token', pair!
      get '/api/admin_native/v1/visitors'
      assert_equal [404, 'unsupported'], [last_response.status, json.dig('error', 'code')]
    end
    adapter = StubVisitors.new
    with_gem_config(visitors_adapter: adapter) do
      get '/api/admin_native/v1/capabilities'
      assert_includes json['capabilities'], 'visitors'

      get '/api/admin_native/v1/visitors', online: true
      assert_equal 200, last_response.status, last_response.body
      assert_equal [true, 1, 25], adapter.calls.last.last.values_at(:online, :page, :per_page)
      assert_equal({ 'page' => 1, 'per_page' => 25, 'total_count' => 1 }, json['meta'])
      session = json['data'].first
      assert_equal %w[id contact user_id current_url current_title referrer utm device country started_at last_seen_at online page_views cart conversation_id],
                   session.keys
      assert_equal ['55', '3', 'mobile', true, 4, '12'], session.values_at('id', 'user_id', 'device', 'online', 'page_views', 'conversation_id')
      assert_equal({ 'id' => '7', 'name' => 'Ada', 'email' => 'ada@example.com' }, session['contact'])
      assert_equal({ 'source' => 'news', 'medium' => 'email', 'campaign' => 'fall' }, session['utm'])
      assert_equal({ 'order_number' => 'R123', 'item_count' => 2, 'total' => '18.50', 'currency' => 'USD' }, session['cart'])

      get '/api/admin_native/v1/visitors'
      assert_nil adapter.calls.last.last[:online]
      away = json['data'].last
      assert_equal [false, nil, nil, nil, nil], away.values_at('online', 'contact', 'utm', 'cart', 'device'), 'online from last_seen_at; unknown devices dropped'

      get '/api/admin_native/v1/visitors/55'
      assert_equal 200, last_response.status
      pages = json.dig('data', 'pages')
      assert_equal 50, pages.size
      assert_equal ['/p/60', '/p/11'], [pages.first['url'], pages.last['url']], 'the last 50, newest first'
      get '/api/admin_native/v1/visitors/99'
      assert_equal 404, last_response.status

      post '/api/admin_native/v1/visitors/55/conversation'
      assert_equal 200, last_response.status
      assert_equal [{ 'conversation_id' => '12' }, '12'], [json['data'], json['conversation_id']]
      assert_equal [:start_conversation, 55, @admin.id], adapter.calls.last
      post '/api/admin_native/v1/visitors/56/conversation'
      assert_equal '77', json.dig('data', 'conversation_id'), 'a bare id works too'

      adapter.broken = true
      get '/api/admin_native/v1/visitors'
      assert_equal [502, 'adapter_failed'], [last_response.status, json.dig('error', 'code')], 'a session without last_seen_at'
    end
  end

  # --- 0.7: summary -------------------------------------------------------------------------

  def test_summary_counts_active_carts_and_visitors_online
    make_cart(email: 'fresh@example.com')
    make_cart(email: 'old@example.com', updated: 2.hours.ago)
    header 'X-Spree-Token', pair!
    with_gem_config(visitors_adapter: nil) do
      get '/api/admin_native/v1/summary'
      assert_equal 200, last_response.status
      refute json.key?('visitors_online')
      assert_equal SpreeAdminNative::Carts.active_count, json['active_carts']
      assert_operator json['active_carts'], :>=, 1
      with_gem_config(active_cart_minutes: 180) do
        get '/api/admin_native/v1/summary'
        assert_equal SpreeAdminNative::Carts.scope(active_within: 180).count, json['active_carts']
      end
    end
    adapter = StubVisitors.new
    with_gem_config(visitors_adapter: adapter) do
      get '/api/admin_native/v1/summary'
      assert_equal 1, json['visitors_online']
      assert_equal [true, 1, 1, @admin.id], adapter.calls.last.last.then { |f| [f[:online], f[:page], f[:per_page], f[:admin].id] }
      adapter.broken = true
      def adapter.sessions(_filters)
        raise 'down'
      end
      get '/api/admin_native/v1/summary'
      assert_equal 200, last_response.status, 'Home still loads'
      refute json.key?('visitors_online')
    end
  end
end
