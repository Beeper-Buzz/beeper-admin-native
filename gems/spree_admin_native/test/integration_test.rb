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
end
