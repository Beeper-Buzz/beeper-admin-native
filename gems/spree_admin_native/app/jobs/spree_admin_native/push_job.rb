module SpreeAdminNative
  class PushJob < ActiveJob::Base
    queue_as :default

    # 'order.completed' with an order id; 'inbox.message' with { 'title', 'body', 'data' }
    # (SpreeAdminNative::Inbox.notify_inbound).
    def perform(event, subject)
      case event
      when 'order.completed' then deliver_new_order(subject)
      when 'inbox.message' then deliver_inbox_message(subject)
      end
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

    private

    def deliver_new_order(order_id)
      order = Spree::Order.find_by(id: order_id)
      devices = Device.pushable
      return if order.nil? || devices.none?

      ExpoPush.new.deliver(devices, **self.class.new_order_message(order))
    end

    def deliver_inbox_message(message)
      devices = Device.pushable
      return if devices.none? || !message.respond_to?(:to_hash)

      message = message.to_hash.with_indifferent_access
      ExpoPush.new.deliver(devices, title: message[:title].to_s, body: message[:body].to_s, data: message[:data].to_h)
    end
  end
end
