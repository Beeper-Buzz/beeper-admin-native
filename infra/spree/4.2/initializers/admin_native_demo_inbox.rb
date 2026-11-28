# DEMO ONLY: an inbox and a visitors adapter for the Spree 4.2 test store, so the app's contract
# tests can prove the inbox, visitors and tree endpoints of companion gem 0.7
# (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md). A real host (dna-admin) keeps
# conversations, contacts and sessions in its own models and writes its own adapters.
#
# docker-compose.yml mounts this file into config/initializers/; it takes effect on a restart.
# When it runs it creates three small tables if they don't exist (no migration, test store only):
#
#   admin_native_demo_conversations  a conversation with one customer
#   admin_native_demo_messages       its messages (inbound, outbound, note)
#   admin_native_demo_sessions       storefront sessions for the visitors adapter
#
# It seeds nothing. Contract tests create data through the runner, e.g.
#
#   docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner \
#     'puts AdminNativeDemo.inbound!(name: "Ada", email: "ada@example.com", body: "Is this in stock?").to_json'
#   docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner \
#     'puts AdminNativeDemo.visit!(name: "Ada", email: "ada@example.com", url: "/products/mug").to_json'
#   docker compose -f infra/spree/docker-compose.yml exec -T spree42 bin/rails runner 'AdminNativeDemo.clear!'
#
# It also registers a demo tree: `taxons` (Spree::Taxon, grouped by taxonomy) with the hidden
# `taxonomies` type as its group.
if defined?(SpreeAdminNative) && SpreeAdminNative.respond_to?(:resources) && defined?(SpreeAdminNative::Inbox::Adapter)
  module AdminNativeDemo
    class Conversation < ActiveRecord::Base
      self.table_name = 'admin_native_demo_conversations'
      has_many :messages, class_name: 'AdminNativeDemo::Message', foreign_key: :conversation_id, dependent: :delete_all
    end

    class Message < ActiveRecord::Base
      self.table_name = 'admin_native_demo_messages'
      belongs_to :conversation, class_name: 'AdminNativeDemo::Conversation'
    end

    class Session < ActiveRecord::Base
      self.table_name = 'admin_native_demo_sessions'
    end

    class << self
      def create_tables!
        connection = ActiveRecord::Base.connection
        connection.create_table :admin_native_demo_conversations, if_not_exists: true do |t|
          t.string :contact_name
          t.string :contact_email
          t.string :status, null: false, default: 'open'
          t.string :channel, null: false, default: 'web'
          t.string :subject
          t.integer :assignee_id
          t.datetime :snoozed_until
          t.datetime :last_message_at
          t.timestamps
        end
        connection.create_table :admin_native_demo_messages, if_not_exists: true do |t|
          t.integer :conversation_id, null: false, index: true
          t.string :direction, null: false
          t.text :body
          t.string :channel
          t.string :author_name
          t.integer :author_id
          t.jsonb :attachments, null: false, default: []
          t.string :delivery
          t.datetime :read_at
          t.timestamps
        end
        connection.create_table :admin_native_demo_sessions, if_not_exists: true do |t|
          t.string :contact_name
          t.string :contact_email
          t.integer :user_id
          t.string :current_url
          t.string :current_title
          t.string :referrer
          t.string :utm_source
          t.string :utm_medium
          t.string :utm_campaign
          t.string :device
          t.string :country
          t.datetime :started_at
          t.datetime :last_seen_at
          t.integer :page_views, null: false, default: 0
          t.string :order_number
          t.integer :conversation_id
          t.jsonb :pages, null: false, default: []
          t.timestamps
        end
        [Conversation, Message, Session].each(&:reset_column_information)
      end

      # A customer writes: finds or opens their conversation, stores the message and pushes to
      # the paired devices (throttled by the gem). Returns { conversation_id, message_id }.
      def inbound!(body:, name: nil, email: nil, conversation_id: nil, channel: 'web')
        conversation = conversation_id ? Conversation.find(conversation_id) : nil
        conversation ||= Conversation.where(contact_email: email, status: %w[open snoozed]).order(:id).last if email
        conversation ||= Conversation.create!(contact_name: name, contact_email: email, channel: channel)
        message = conversation.messages.create!(direction: 'inbound', body: body, channel: conversation.channel, author_name: name || conversation.contact_name)
        conversation.update!(status: 'open', snoozed_until: nil, last_message_at: message.created_at)
        adapter = InboxAdapter.new
        SpreeAdminNative::Inbox.notify_inbound(adapter.conversation_hash(conversation), adapter.message_hash(message))
        { conversation_id: conversation.id.to_s, message_id: message.id.to_s }
      end

      # A storefront page view. Returns { session_id }.
      def visit!(url:, title: nil, name: nil, email: nil, session_id: nil, device: 'desktop', country: nil,
                 referrer: nil, utm: nil, order_number: nil, at: Time.current)
        session = session_id ? Session.find(session_id) : nil
        session ||= Session.create!(contact_name: name, contact_email: email, device: device, country: country, referrer: referrer,
                                    utm_source: utm&.dig(:source), utm_medium: utm&.dig(:medium), utm_campaign: utm&.dig(:campaign),
                                    user_id: email && Spree.user_class.find_by(email: email)&.id, started_at: at)
        pages = (session.pages + [{ 'url' => url, 'title' => title, 'at' => at.iso8601 }]).last(100)
        session.update!(current_url: url, current_title: title, last_seen_at: at, page_views: session.page_views + 1,
                        pages: pages, order_number: order_number || session.order_number)
        { session_id: session.id.to_s }
      end

      # Deletes every demo conversation, message and session.
      def clear!
        [Message, Conversation, Session].each(&:delete_all)
        true
      end

      def cart_for(email: nil, number: nil)
        scope = Spree::Order.where(completed_at: nil, state: SpreeAdminNative::Carts::STATES)
        scope = number ? scope.where(number: number) : scope.where(email: email)
        return nil if number.nil? && email.nil?

        scope.joins(:line_items).distinct.order(updated_at: :desc).first
      end
    end

    class InboxAdapter < SpreeAdminNative::Inbox::Adapter
      def available?
        Conversation.table_exists?
      end

      def conversations(filters)
        rel = Conversation.all
        rel = rel.where(status: filters[:status]) unless filters[:status] == 'all'
        case filters[:assignee]
        when 'me' then rel = rel.where(assignee_id: filters[:admin]&.id)
        when 'unassigned' then rel = rel.where(assignee_id: nil)
        end
        if filters[:q]
          term = "%#{Conversation.sanitize_sql_like(filters[:q].downcase)}%"
          rel = rel.where('LOWER(contact_name) LIKE :t OR LOWER(contact_email) LIKE :t OR LOWER(subject) LIKE :t', t: term)
        end
        rel = rel.where('updated_at > ?', filters[:updated_since]) if filters[:updated_since]
        page = rel.order(Arel.sql('COALESCE(last_message_at, updated_at) DESC, id DESC'))
                  .offset((filters[:page] - 1) * filters[:per_page]).limit(filters[:per_page])
        { records: page.map { |c| conversation_hash(c) }, total: rel.count }
      end

      def conversation(id)
        record = Conversation.find_by(id: id)
        record && conversation_hash(record)
      end

      def messages(conversation, before:, after:, limit:)
        rel = Message.where(conversation_id: conversation[:id])
        rows =
          if after then rel.where('id > ?', after.to_i).order(:id).limit(limit).to_a
          elsif before then rel.where('id < ?', before.to_i).order(id: :desc).limit(limit).to_a.reverse
          else rel.order(id: :desc).limit(limit).to_a.reverse
          end
        rows.map { |m| message_hash(m) }
      end

      def reply(conversation, admin, body:, attachments:, note:)
        record = Conversation.find(conversation[:id])
        files = attachments.map do |signed_id|
          blob = ActiveStorage::Blob.find_signed(signed_id)
          { 'url' => Rails.application.routes.url_helpers.rails_blob_path(blob, only_path: true),
            'filename' => blob.filename.to_s, 'content_type' => blob.content_type }
        end
        message = record.messages.create!(direction: note ? 'note' : 'outbound', body: body, channel: record.channel,
                                          author_name: admin.email, author_id: admin.id, attachments: files,
                                          delivery: note ? nil : 'sent')
        record.update!(last_message_at: message.created_at)
        message_hash(message)
      end

      def update(conversation, _admin, attrs)
        record = Conversation.find(conversation[:id])
        if attrs.key?(:assignee_id) && attrs[:assignee_id] && !Spree.user_class.exists?(attrs[:assignee_id])
          raise SpreeAdminNative::AdapterInvalid, 'No such staff member.'
        end

        record.update!(attrs.slice(:status, :assignee_id, :snoozed_until))
        conversation_hash(record)
      end

      def mark_read(conversation, _admin)
        Message.where(conversation_id: conversation[:id], direction: 'inbound', read_at: nil).update_all(read_at: Time.current)
        conversation(conversation[:id])
      end

      def summary(_admin)
        open = Conversation.where(status: 'open')
        unread = Message.where(direction: 'inbound', read_at: nil, conversation_id: open.select(:id)).distinct.count(:conversation_id)
        { open: open.count, unassigned: open.where(assignee_id: nil).count, unread: unread }
      end

      def customer_context(conversation)
        record = Conversation.find(conversation[:id])
        email = record.contact_email
        user = email && Spree.user_class.find_by(email: email)
        session = Session.where(conversation_id: record.id).order(last_seen_at: :desc).first ||
                  (email && Session.where(contact_email: email).order(last_seen_at: :desc).first)
        cart = AdminNativeDemo.cart_for(email: email, number: session&.order_number)
        orders = email ? Spree::Order.complete.where(email: email).order(completed_at: :desc).limit(5) : []
        {
          contact: { id: record.id, name: record.contact_name, email: email, phone: nil },
          user: user && { id: user.id, email: user.email },
          session: session && { id: session.id, current_url: session.current_url, last_seen_at: session.last_seen_at },
          cart: cart && { order_number: cart.number, item_count: cart.item_count, total: cart.total, currency: cart.currency,
                          items: cart.line_items.map { |li| { name: li.variant.product.name, quantity: li.quantity, image_url: nil } } },
          recent_orders: orders.map { |o| { number: o.number, state: o.state, total: o.total, completed_at: o.completed_at } }
        }
      end

      def conversation_hash(record)
        last = record.messages.order(:id).last
        assignee = record.assignee_id && Spree.user_class.find_by(id: record.assignee_id)
        user = record.contact_email && Spree.user_class.find_by(email: record.contact_email)
        {
          id: record.id, status: record.status, channel: record.channel, subject: record.subject,
          customer: { name: record.contact_name, email: record.contact_email, avatar_url: nil, contact_id: record.id, user_id: user&.id },
          assignee: assignee && { id: assignee.id, email: assignee.email },
          unread: record.messages.where(direction: 'inbound', read_at: nil).count,
          last_message: last && { body: last.body, direction: last.direction, at: last.created_at },
          updated_at: record.updated_at, snoozed_until: record.snoozed_until
        }
      end

      def message_hash(record)
        {
          id: record.id, direction: record.direction, body: record.body, channel: record.channel,
          author: { kind: record.direction == 'inbound' ? 'customer' : 'staff', name: record.author_name },
          attachments: record.attachments, created_at: record.created_at, read_at: record.read_at, delivery: record.delivery
        }
      end
    end

    class VisitorsAdapter < SpreeAdminNative::Visitors::Adapter
      def available?
        Session.table_exists?
      end

      def sessions(filters)
        rel = Session.all
        window = SpreeAdminNative::Visitors::ONLINE_WINDOW.seconds.ago
        rel = rel.where('last_seen_at >= ?', window) if filters[:online] == true
        rel = rel.where('last_seen_at < ?', window) if filters[:online] == false
        page = rel.order(last_seen_at: :desc, id: :desc).offset((filters[:page] - 1) * filters[:per_page]).limit(filters[:per_page])
        { records: page.map { |s| session_hash(s) }, total: rel.count }
      end

      def session(id)
        record = Session.find_by(id: id)
        record && session_hash(record).merge(pages: record.pages)
      end

      def start_conversation(session, _admin)
        record = Session.find(session[:id])
        unless record.conversation_id && Conversation.exists?(record.conversation_id)
          conversation = Conversation.create!(contact_name: record.contact_name, contact_email: record.contact_email, channel: 'web')
          record.update!(conversation_id: conversation.id)
        end
        { conversation_id: record.conversation_id }
      end

      def session_hash(record)
        cart = record.order_number && AdminNativeDemo.cart_for(number: record.order_number)
        utm = record.utm_source || record.utm_medium || record.utm_campaign
        {
          id: record.id,
          contact: record.contact_email || record.contact_name ? { id: record.id, name: record.contact_name, email: record.contact_email } : nil,
          user_id: record.user_id, current_url: record.current_url, current_title: record.current_title, referrer: record.referrer,
          utm: utm && { source: record.utm_source, medium: record.utm_medium, campaign: record.utm_campaign },
          device: record.device, country: record.country, started_at: record.started_at, last_seen_at: record.last_seen_at,
          page_views: record.page_views,
          cart: cart && { order_number: cart.number, item_count: cart.item_count, total: cart.total, currency: cart.currency },
          conversation_id: record.conversation_id
        }
      end
    end
  end

  begin
    AdminNativeDemo.create_tables!
  rescue *SpreeAdminNative::Resources.database_errors => e
    Rails.logger.warn("[admin_native_demo] demo tables not created: #{e.class}: #{e.message}")
  end

  SpreeAdminNative.configure do |c|
    c.inbox_adapter = AdminNativeDemo::InboxAdapter.new
    c.visitors_adapter = AdminNativeDemo::VisitorsAdapter.new
  end

  # Demo tree: taxons, one tree per taxonomy. Spree::Taxon is an awesome_nested_set; after a move
  # the gem renumbers lft / rgt / depth in position order, so Spree's own tree stays valid. A move
  # writes parent_id and position only: Spree's permalinks aren't regenerated.
  SpreeAdminNative.resources.register 'taxonomies' do |r|
    r.model 'Spree::Taxonomy'
    r.label 'Taxonomies'
    r.singular 'Taxonomy'
    r.group 'Catalog'
    r.icon 'square.stack.3d.up'
    r.hidden
    r.title :name
    r.search :name
    r.order :position
    r.fields :auto
  end

  SpreeAdminNative.resources.register 'taxons' do |r|
    r.model 'Spree::Taxon'
    r.label 'Taxons'
    r.singular 'Taxon'
    r.group 'Catalog'
    r.icon 'list.bullet.indent'
    r.title :name
    r.subtitle :permalink
    r.search :name
    r.filter :taxonomy_id
    r.order :position, :asc
    r.view :tree, parent: :parent_id, position: :position, group: :taxonomy_id
    r.field :name, :string, required: true
    r.field :taxonomy_id, :reference, resource: 'taxonomies', label: 'Taxonomy', required: true
    # Spree allows one root per taxonomy, so a new taxon needs a parent.
    r.field :parent_id, :reference, resource: 'taxons', label: 'Parent'
    r.field :position, :integer, readonly: true
    r.field :permalink, :string, readonly: true
    r.field :hide_from_nav, :boolean, label: 'Hidden from navigation'
    r.actions destroy: false
  end
end
