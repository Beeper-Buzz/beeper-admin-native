module SpreeAdminNative
  # Who is on the storefront now, from the host's session tracking, through an adapter
  # (SpreeAdminNative.config.visitors_adapter).
  module Visitors
    ONLINE_WINDOW = 2 * 60 # seconds
    PAGES_LIMIT = 50
    DEVICES = %w[mobile desktop tablet].freeze

    # Subclass it and set `SpreeAdminNative.config.visitors_adapter`. Returns plain hashes in the
    # shapes of the README's Carts and visitors section.
    class Adapter
      def available?
        true
      end

      # filters: { online: true|false|nil, page:, per_page:, admin: }. Most recently seen first.
      # Returns { records: [session], total: Integer }.
      def sessions(_filters)
        raise NotImplementedError, "#{self.class}#sessions"
      end

      # A session hash with `pages: [{ url, title, at }]`, or nil.
      def session(_id)
        raise NotImplementedError, "#{self.class}#session"
      end

      # Starts (or finds) the conversation with that visitor. Returns { conversation_id: }.
      def start_conversation(_session, _admin)
        raise NotImplementedError, "#{self.class}#start_conversation"
      end
    end

    class << self
      def adapter
        Adapters.resolve(SpreeAdminNative.config.visitors_adapter)
      end

      def available?
        Adapters.available?(adapter)
      end

      # The adapter's `online`, or seen within the last 2 minutes.
      def online?(session)
        given = session[:online]
        return !!Adapters.bool(given) unless given.nil?

        seen = Adapters.parse_time(session[:last_seen_at])
        !seen.nil? && seen >= Time.current - ONLINE_WINDOW
      end

      def session_json(value, pages: false)
        h = Adapters.require_keys!(Adapters.hash!(value, 'visitor session'), %i[id last_seen_at], 'visitor session')
        contact = Adapters.hash_or_nil(h[:contact], 'session contact')
        utm = Adapters.hash_or_nil(h[:utm], 'session utm')
        cart = Adapters.hash_or_nil(h[:cart], 'session cart')
        json = {
          id: h[:id].to_s,
          contact: contact && { id: Adapters.id(contact[:id]), name: Adapters.string(contact[:name]), email: Adapters.string(contact[:email]) },
          user_id: Adapters.id(h[:user_id]),
          current_url: Adapters.string(h[:current_url]),
          current_title: Adapters.string(h[:current_title]),
          referrer: Adapters.string(h[:referrer]),
          utm: utm && %i[source medium campaign].map { |k| [k, Adapters.string(utm[k])] }.to_h,
          device: DEVICES.include?(h[:device].to_s) ? h[:device].to_s : nil,
          country: Adapters.string(h[:country]),
          started_at: Adapters.time(h[:started_at], 'session started_at'),
          last_seen_at: Adapters.time(h[:last_seen_at], 'session last_seen_at'),
          online: online?(h),
          page_views: Adapters.int(h[:page_views], 'session page_views') || 0,
          cart: cart && {
            order_number: Adapters.string(cart[:order_number]),
            item_count: Adapters.int(cart[:item_count], 'session cart item_count') || 0,
            total: Adapters.money(cart[:total]), currency: Adapters.string(cart[:currency])
          },
          conversation_id: Adapters.id(h[:conversation_id])
        }
        json[:pages] = pages_json(h[:pages]) if pages
        json
      end

      # The last 50 pages, newest first.
      def pages_json(value)
        pages = Adapters.array!(value, 'session pages').map do |page|
          page = Adapters.hash!(page, 'session page')
          { url: Adapters.string(page[:url]), title: Adapters.string(page[:title]), at: Adapters.time(page[:at], 'page at') }
        end
        pages.each_with_index.sort_by { |p, i| [-(Adapters.parse_time(p[:at])&.to_f || 0), i] }.map(&:first).first(PAGES_LIMIT)
      end
    end
  end
end
