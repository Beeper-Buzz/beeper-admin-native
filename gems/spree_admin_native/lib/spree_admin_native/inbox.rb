module SpreeAdminNative
  # Customer conversations, kept by the host and served to the app through an adapter
  # (SpreeAdminNative.config.inbox_adapter). The gem owns the API, the shapes and the push; the
  # host owns the data and the channels (web chat, email…).
  module Inbox
    STATUSES = %w[open snoozed closed].freeze
    STATUS_FILTERS = (STATUSES + %w[all]).freeze
    ASSIGNEE_FILTERS = %w[me unassigned any].freeze
    DIRECTIONS = %w[inbound outbound note].freeze
    AUTHOR_KINDS = %w[customer staff system].freeze
    DELIVERIES = %w[sent delivered failed].freeze
    PUSH_BODY_LIMIT = 140

    # Subclass it and set `SpreeAdminNative.config.inbox_adapter`. Every method returns plain
    # hashes (string or symbol keys) in the shapes of the README's Inbox section; the gem checks
    # and serializes them. Raise SpreeAdminNative::AdapterInvalid to refuse what the app sent
    # (422); anything else raised is a 502 `adapter_failed`.
    class Adapter
      # Whether the inbox is on (a table exists, a setting is on…). True unless overridden.
      def available?
        true
      end

      # filters: { status: 'open'|'snoozed'|'closed'|'all', assignee: 'me'|'unassigned'|'any',
      # q: String|nil, page: Integer, per_page: Integer, updated_since: Time|nil, admin: user }.
      # Newest activity first. Returns { records: [conversation], total: Integer }.
      def conversations(_filters)
        raise NotImplementedError, "#{self.class}#conversations"
      end

      # A conversation hash, or nil when there is none with that id.
      def conversation(_id)
        raise NotImplementedError, "#{self.class}#conversation"
      end

      # Oldest first, at most `limit`: before the message id `before` (scrolling back), after
      # `after` (polling), or the latest ones. Returns [message].
      def messages(_conversation, before:, after:, limit:)
        raise NotImplementedError, "#{self.class}#messages"
      end

      # Sends the reply on the conversation's channel (`note: true`: an internal note, never sent).
      # attachments are ActiveStorage signed ids. Returns the new message.
      def reply(_conversation, _admin, body:, attachments:, note:)
        raise NotImplementedError, "#{self.class}#reply"
      end

      # attrs: any of { status:, assignee_id:, snoozed_until: (Time|nil) }. Returns the conversation.
      def update(_conversation, _admin, _attrs)
        raise NotImplementedError, "#{self.class}#update"
      end

      # Marks every inbound message read for staff. May return the conversation.
      def mark_read(_conversation, _admin)
        raise NotImplementedError, "#{self.class}#mark_read"
      end

      # { open:, unassigned:, unread: } for the app's badges.
      def summary(_admin)
        raise NotImplementedError, "#{self.class}#summary"
      end

      # { contact:, user:, session:, cart:, recent_orders: } for the conversation's customer sheet.
      def customer_context(_conversation)
        raise NotImplementedError, "#{self.class}#customer_context"
      end
    end

    class << self
      def adapter
        Adapters.resolve(SpreeAdminNative.config.inbox_adapter)
      end

      def available?
        Adapters.available?(adapter)
      end

      # The host calls this when a customer writes (after the message is saved and committed).
      # Pushes "<customer name>: <message>" to every paired admin device through Expo, at most
      # once per conversation per `inbox_push_throttle` seconds. Never raises: returns true when
      # a push was queued, false when throttled, skipped or failed.
      def notify_inbound(conversation_hash, message_hash)
        conversation = Adapters.require_keys!(Adapters.hash!(conversation_hash, 'conversation'), %i[id], 'conversation')
        message = Adapters.hash!(message_hash, 'message')
        return false if message[:direction].present? && message[:direction].to_s != 'inbound'

        key = "spree_admin_native/inbox_push/#{conversation[:id]}"
        throttle = SpreeAdminNative.config.inbox_push_throttle.to_i
        if throttle.positive?
          store = throttle_store
          # read first: it drops an expired entry, which some stores' unless_exist would still see.
          return false if store.read(key)
          return false unless store.write(key, Time.current.to_i, expires_in: throttle, unless_exist: true)
        end

        PushJob.perform_later('inbox.message', push_message(conversation, message))
        true
      rescue StandardError => e
        Rails.logger.warn("[spree_admin_native] inbox push: #{e.class}: #{e.message}")
        false
      end

      # { 'title', 'body', 'data' } for ExpoPush#deliver.
      def push_message(conversation, message)
        customer = conversation[:customer].respond_to?(:to_hash) ? conversation[:customer].to_hash.with_indifferent_access : {}
        title = [customer[:name], customer[:email]].map { |v| v.to_s.strip }.find(&:present?) || 'New message'
        body = message[:body].to_s.squish
        body = 'Sent an attachment' if body.empty? && Array(message[:attachments]).any?
        {
          'title' => title,
          'body' => body.truncate(PUSH_BODY_LIMIT, omission: '…'),
          'data' => { 'type' => 'inbox', 'conversation_id' => conversation[:id].to_s }
        }
      end

      def throttle_store
        configured = SpreeAdminNative.config.cache_store
        return configured if configured

        cache = Rails.cache
        return cache if cache && !cache.is_a?(ActiveSupport::Cache::NullStore)

        @memory_store ||= ActiveSupport::Cache::MemoryStore.new(size: 4.megabytes)
      end

      # --- Shapes ----------------------------------------------------------------------------

      def conversation_json(value)
        h = Adapters.require_keys!(Adapters.hash!(value, 'conversation'), %i[id status], 'conversation')
        customer = Adapters.hash_or_nil(h[:customer], 'conversation customer') || {}
        assignee = Adapters.hash_or_nil(h[:assignee], 'conversation assignee')
        last = Adapters.hash_or_nil(h[:last_message], 'conversation last_message')
        {
          id: h[:id].to_s,
          status: Adapters.one_of(h[:status], STATUSES, 'conversation status'),
          channel: Adapters.string(h[:channel]),
          subject: Adapters.string(h[:subject]),
          customer: {
            name: Adapters.string(customer[:name]), email: Adapters.string(customer[:email]),
            avatar_url: Adapters.string(customer[:avatar_url]),
            contact_id: Adapters.id(customer[:contact_id]), user_id: Adapters.id(customer[:user_id])
          },
          assignee: assignee && Adapters.id(assignee[:id]) ? { id: Adapters.id(assignee[:id]), email: Adapters.string(assignee[:email]) } : nil,
          unread: Adapters.int(h[:unread], 'conversation unread') || 0,
          last_message: last && {
            body: last[:body].to_s,
            direction: Adapters.one_of(last[:direction], DIRECTIONS, 'last_message direction'),
            at: Adapters.time(last[:at], 'last_message at')
          },
          updated_at: Adapters.time(h[:updated_at], 'conversation updated_at'),
          snoozed_until: Adapters.time(h[:snoozed_until], 'conversation snoozed_until')
        }
      end

      def message_json(value)
        h = Adapters.require_keys!(Adapters.hash!(value, 'message'), %i[id direction created_at], 'message')
        direction = Adapters.one_of(h[:direction], DIRECTIONS, 'message direction')
        author = Adapters.hash_or_nil(h[:author], 'message author') || {}
        {
          id: h[:id].to_s,
          direction: direction,
          body: h[:body].to_s,
          channel: Adapters.string(h[:channel]),
          author: {
            kind: Adapters.one_of(author[:kind], AUTHOR_KINDS, 'message author kind') || (direction == 'inbound' ? 'customer' : 'staff'),
            name: Adapters.string(author[:name])
          },
          attachments: Adapters.array!(h[:attachments], 'message attachments').map do |a|
            a = Adapters.require_keys!(Adapters.hash!(a, 'message attachment'), %i[url], 'message attachment')
            { url: a[:url].to_s, filename: Adapters.string(a[:filename]), content_type: Adapters.string(a[:content_type]) }
          end,
          created_at: Adapters.time(h[:created_at], 'message created_at'),
          read_at: Adapters.time(h[:read_at], 'message read_at'),
          delivery: Adapters.one_of(h[:delivery], DELIVERIES, 'message delivery')
        }
      end

      def customer_context_json(value)
        h = Adapters.hash_or_nil(value, 'customer context') || {}
        contact = Adapters.hash_or_nil(h[:contact], 'customer context contact')
        user = Adapters.hash_or_nil(h[:user], 'customer context user')
        session = Adapters.hash_or_nil(h[:session], 'customer context session')
        cart = Adapters.hash_or_nil(h[:cart], 'customer context cart')
        {
          contact: contact && {
            id: Adapters.id(contact[:id]), name: Adapters.string(contact[:name]),
            email: Adapters.string(contact[:email]), phone: Adapters.string(contact[:phone])
          },
          user: user && { id: Adapters.id(user[:id]), email: Adapters.string(user[:email]) },
          session: session && {
            id: Adapters.require_keys!(session, %i[id], 'customer context session')[:id].to_s,
            current_url: Adapters.string(session[:current_url]),
            last_seen_at: Adapters.time(session[:last_seen_at], 'session last_seen_at'),
            online: Visitors.online?(session)
          },
          cart: cart && {
            order_number: Adapters.string(cart[:order_number]),
            item_count: Adapters.int(cart[:item_count], 'cart item_count') || 0,
            total: Adapters.money(cart[:total]), currency: Adapters.string(cart[:currency]),
            items: Adapters.array!(cart[:items], 'cart items').map do |item|
              item = Adapters.hash!(item, 'cart item')
              { name: Adapters.string(item[:name]), quantity: Adapters.int(item[:quantity], 'cart item quantity') || 0,
                image_url: Adapters.string(item[:image_url]) }
            end
          },
          recent_orders: Adapters.array!(h[:recent_orders], 'recent orders').map do |order|
            order = Adapters.hash!(order, 'recent order')
            { number: Adapters.string(order[:number]), state: Adapters.string(order[:state]),
              total: Adapters.money(order[:total]), completed_at: Adapters.time(order[:completed_at], 'order completed_at') }
          end
        }
      end

      def summary_json(value)
        h = Adapters.require_keys!(Adapters.hash!(value, 'inbox summary'), %i[open unassigned unread], 'inbox summary')
        %i[open unassigned unread].map { |key| [key, Adapters.int(h[key], "inbox summary #{key}")] }.to_h
      end
    end
  end
end
