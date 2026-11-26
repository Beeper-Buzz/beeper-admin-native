module SpreeAdminNative
  class PushJob < ActiveJob::Base
    queue_as :default

    def perform(event, order_id)
      return unless event == 'order.completed'

      order = Spree::Order.find_by(id: order_id)
      devices = Device.pushable
      return if order.nil? || devices.none?

      ExpoPush.new.deliver(devices, **self.class.new_order_message(order))
    end

    # "New order R123456789" / "$184.00 · 3 items · Portland, OR"
    def self.new_order_message(order)
      address = order.ship_address || order.bill_address
      place = address ? [address.city, address.state&.abbr || address.country&.iso].compact.join(', ') : nil
      items = order.line_items.sum(:quantity)
      body = [order.display_total.to_s, "#{items} #{items == 1 ? 'item' : 'items'}", place].compact.join(' · ')
      { title: "New order #{order.number}", body: body,
        data: { type: 'order.completed', orderNumber: order.number, url: "/orders/#{order.number}" } }
    end
  end
end
