module SpreeAdminNative
  # Home screen numbers in one request, computed in SQL (Spree 4.x order columns).
  class Summary
    UNFULFILLED = %w[pending ready partial backorder].freeze
    UNPAID = %w[balance_due failed].freeze

    def initialize(now: Time.zone.now, admin: nil)
      @admin = admin
      @now = now
      @store = Spree::Store.respond_to?(:default) ? Spree::Store.default : Spree::Store.first
    end

    def as_json(*)
      currency = @store&.default_currency || 'USD'
      today = placed.where(completed_at: @now.beginning_of_day..@now).where(currency: currency)
      json = {
        currency: currency,
        time_zone: Time.zone.name,
        today: { orders: today.count, sales: format('%.2f', today.sum(:total)) },
        orders_to_fulfill: placed.where(shipment_state: UNFULFILLED).count,
        payments_due: placed.where(payment_state: UNPAID).count,
        low_stock_variants: LowStock.variant_count
      }
      # 0.7: carts updated within active_cart_minutes, and visitors online when the store tracks them.
      json[:active_carts] = Carts.active_count(minutes: SpreeAdminNative.config.active_cart_minutes)
      online = visitors_online
      json[:visitors_online] = online unless online.nil?
      json[:generated_at] = @now.iso8601
      json
    end

    private

    # The adapter's total of online sessions; nil without visitors, or when the adapter fails
    # (Home still loads).
    def visitors_online
      adapter = Visitors.adapter
      return nil unless Adapters.available?(adapter)

      result = Adapters.call(adapter, :sessions) { adapter.sessions(online: true, page: 1, per_page: 1, admin: @admin) }
      Adapters.page!(result, 'visitor sessions').last
    rescue AdapterError, AdapterInvalid, ActiveRecord::RecordNotFound
      nil
    end

    def placed
      Spree::Order.where.not(completed_at: nil).where(state: %w[complete resumed awaiting_return])
    end

  end
end
