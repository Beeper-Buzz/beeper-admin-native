module SpreeAdminNative
  # Home screen numbers in one request, computed in SQL (Spree 4.x order columns).
  class Summary
    UNFULFILLED = %w[pending ready partial backorder].freeze
    UNPAID = %w[balance_due failed].freeze

    def initialize(now: Time.zone.now)
      @now = now
      @store = Spree::Store.respond_to?(:default) ? Spree::Store.default : Spree::Store.first
    end

    def as_json(*)
      currency = @store&.default_currency || 'USD'
      today = placed.where(completed_at: @now.beginning_of_day..@now).where(currency: currency)
      {
        currency: currency,
        time_zone: Time.zone.name,
        today: { orders: today.count, sales: format('%.2f', today.sum(:total)) },
        orders_to_fulfill: placed.where(shipment_state: UNFULFILLED).count,
        payments_due: placed.where(payment_state: UNPAID).count,
        low_stock_variants: LowStock.variant_count,
        generated_at: @now.iso8601
      }
    end

    private

    def placed
      Spree::Order.where.not(completed_at: nil).where(state: %w[complete resumed awaiting_return])
    end

  end
end
