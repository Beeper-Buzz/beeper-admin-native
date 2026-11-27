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
      assert_equal '0.5.0', body.dig('meta', 'gem_version')
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
    assert_equal %w[spree_orders spree_products spree_users spree_variants], builtins.keys.sort
    builtins.each_value do |d|
      assert_equal true, d['hidden']
      assert_equal [false, false, false], [d['create'], d['update'], d['destroy']]
      assert(d['fields'].all? { |f| f['readonly'] })
    end
    assert_equal %w[email created_at], builtins['spree_users']['fields'].map { |f| f['name'] }
    assert_equal %w[name slug created_at], builtins['spree_products']['fields'].map { |f| f['name'] }
    assert_equal %w[sku created_at], builtins['spree_variants']['fields'].map { |f| f['name'] }
    assert_equal %w[number email created_at], builtins['spree_orders']['fields'].map { |f| f['name'] }
    assert_equal 'email', builtins['spree_users']['title_field']

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
end
