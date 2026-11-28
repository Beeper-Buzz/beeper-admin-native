module SpreeAdminNative
  # Shoppers' carts: incomplete orders in a checkout state with at least one line item, newest
  # activity first. Drafts staff started for a customer (created by an admin for someone else)
  # are left out; they are orders in progress, not carts.
  module Carts
    STATES = %w[cart address delivery payment].freeze
    ABANDONED_AFTER = 60 * 60 # seconds without an update, with an email
    IMAGE_STYLE = :small

    module_function

    # active_within: minutes; with_email: true / false / nil; abandoned: true / false / nil.
    def scope(active_within: nil, with_email: nil, abandoned: nil, now: Time.current)
      orders = Spree::Order.arel_table
      scope = Spree::Order.where(state: STATES, completed_at: nil)
                          .where(Spree::LineItem.where(Spree::LineItem.arel_table[:order_id].eq(orders[:id])).arel.exists)
      scope = without_staff_drafts(scope)
      scope = scope.where(orders[:updated_at].gteq(now - (active_within.to_i * 60))) if active_within
      email_present = orders[:email].not_eq(nil).and(orders[:email].not_eq(''))
      scope = scope.where(email_present) if with_email == true
      scope = scope.where(orders[:email].eq(nil).or(orders[:email].eq(''))) if with_email == false
      if abandoned == true
        scope = scope.where(email_present).where(orders[:updated_at].lteq(now - ABANDONED_AFTER))
      elsif abandoned == false
        scope = scope.where(orders[:email].eq(nil).or(orders[:email].eq('')).or(orders[:updated_at].gt(now - ABANDONED_AFTER)))
      end
      scope
    end

    def list(page: 1, per_page: 25, **filters)
      scope = scope(**filters)
      total = scope.count
      rows = with_items(scope.order(updated_at: :desc, id: :desc).offset((page - 1) * per_page).limit(per_page)).to_a
      [rows, total]
    end

    def find(number)
      with_items(Spree::Order.where(state: STATES, completed_at: nil, number: number.to_s)).first
    end

    def active_count(minutes: SpreeAdminNative.config.active_cart_minutes)
      scope(active_within: minutes).count
    end

    def without_staff_drafts(scope)
      return scope unless Spree::Order.column_names.include?('created_by_id')

      admins = admin_ids
      return scope if admins.nil?

      orders = Spree::Order.arel_table
      # NOT NULL first, so NOT (…) keeps guest carts instead of turning NULL into unknown.
      by_staff = orders[:created_by_id].not_eq(nil).and(orders[:created_by_id].in(admins.arel)).and(orders[:user_id].eq(nil).or(orders[:user_id].not_eq(orders[:created_by_id])))
      scope.where.not(by_staff)
    end

    # A subquery of admin user ids, or nil when roles can't be read.
    def admin_ids
      user_class = Spree.user_class
      return nil unless user_class.reflect_on_association(:spree_roles)

      user_class.joins(:spree_roles).where(spree_roles: { name: 'admin' }).select(user_class.arel_table[:id])
    rescue StandardError
      nil
    end

    def with_items(scope)
      scope.includes(line_items: { variant: [:images, { product: { master: :images } }] })
    end

    # url_for: a callable turning an image rendition into an absolute URL (nil skips images).
    def as_json(order, url_for: nil, now: Time.current)
      items = order.line_items.sort_by(&:id)
      {
        number: order.number,
        state: order.state,
        email: order.email.presence,
        user_id: order.user_id&.to_s,
        item_count: items.sum(&:quantity),
        total: format('%.2f', order.total || 0),
        currency: order.currency,
        updated_at: order.updated_at&.iso8601,
        abandoned: order.email.present? && order.updated_at.present? && order.updated_at <= now - ABANDONED_AFTER,
        items: items.map { |item| item_json(item, url_for) }
      }
    end

    def item_json(item, url_for)
      variant = item.variant
      {
        name: variant&.product&.name || item.try(:name),
        variant_sku: variant&.sku.presence,
        quantity: item.quantity,
        image_url: url_for && variant ? image_url(variant, url_for) : nil
      }
    end

    def image_url(variant, url_for)
      image = variant.images.min_by { |i| i.try(:position).to_i } ||
              variant.product&.master&.images&.min_by { |i| i.try(:position).to_i }
      return nil unless image && image.respond_to?(:attachment) && image.attachment.attached?

      url_for.call(image.respond_to?(:url) ? image.url(IMAGE_STYLE) : image.attachment)
    rescue StandardError
      nil
    end
  end
end
