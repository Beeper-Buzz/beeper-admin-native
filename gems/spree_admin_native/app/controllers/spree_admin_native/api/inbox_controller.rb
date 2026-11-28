module SpreeAdminNative
  module Api
    # Customer conversations through the host's inbox adapter (SpreeAdminNative::Inbox::Adapter).
    class InboxController < BaseController
      include AdapterEndpoints

      before_action :load_adapter
      before_action :load_conversation, except: %i[index summary]

      MESSAGES_DEFAULT = 50
      MESSAGES_MAX = 200
      BODY_MAX = 4000

      # GET inbox/conversations
      def index
        filters = conversation_filters
        return if performed?

        records, total = Adapters.page!(adapter_call(:conversations, filters), 'conversations')
        render json: { data: records.map { |c| Inbox.conversation_json(c) },
                       meta: { page: filters[:page], per_page: filters[:per_page], total_count: total } }
      end

      # GET inbox/conversations/:id
      def show
        data = Inbox.conversation_json(@conversation)
        data[:customer_context] = Inbox.customer_context_json(adapter_call(:customer_context, @conversation))
        render json: { data: data }
      end

      # GET inbox/conversations/:id/messages?before=&after=&limit=
      def messages
        limit = params[:limit].present? ? params[:limit].to_i.clamp(1, MESSAGES_MAX) : MESSAGES_DEFAULT
        before = params[:before].presence&.to_s
        after = params[:after].presence&.to_s
        list = Adapters.array!(adapter_call(:messages, @conversation, before: before, after: after, limit: limit), 'messages')
        list = after ? list.first(limit) : list.last(limit)
        render json: { data: list.map { |m| Inbox.message_json(m) }, meta: { limit: limit } }
      end

      # POST inbox/conversations/:id/messages { body, attachments?, note? }
      def reply
        body = params[:body].to_s.strip
        attachments = Array(params[:attachments]).map(&:to_s).reject(&:empty?)
        note = ActiveModel::Type::Boolean.new.cast(params[:note]) || false
        fields = {}
        fields['body'] = ["can't be blank"] if body.empty? && attachments.empty?
        fields['body'] = ["is too long (at most #{BODY_MAX} characters)"] if body.length > BODY_MAX
        fields['attachments'] = ['is not a valid upload'] if attachments.any? { |id| !valid_upload?(id) }
        if fields.any?
          message = fields.map { |name, msgs| "#{name.capitalize} #{msgs.first}" }.to_sentence
          return render_error('invalid', message, :unprocessable_entity, fields)
        end

        result = adapter_call(:reply, @conversation, current_admin, body: body, attachments: attachments, note: note)
        render json: { data: Inbox.message_json(result) }, status: :created
      end

      # PATCH inbox/conversations/:id { status?, assignee_id?, snoozed_until? }
      def update
        attrs, fields = update_attrs
        return render_error('invalid', fields.map { |n, m| "#{n.humanize} #{m.first}" }.to_sentence, :unprocessable_entity, fields) if fields.any?

        render json: { data: Inbox.conversation_json(adapter_call(:update, @conversation, current_admin, attrs)) }
      end

      # POST inbox/conversations/:id/read
      def mark_read
        result = adapter_call(:mark_read, @conversation, current_admin)
        conversation = result.respond_to?(:to_hash) && (result[:id] || result['id']) ? result : adapter_call(:conversation, params[:id].to_s)
        conversation ||= @conversation
        render json: { data: Inbox.conversation_json(conversation) }
      end

      # GET inbox/summary. `data` is the canonical place; the keys are repeated at the top level
      # for clients that read the badge numbers directly.
      def summary
        counts = Inbox.summary_json(adapter_call(:summary, current_admin))
        # Who "me" is, so the app can tell which conversations are assigned to the signed-in admin.
        counts = counts.merge(me: { id: current_admin.id.to_s, email: current_admin.try(:email) })
        render json: { data: counts }.merge(counts)
      end

      private

      def load_adapter
        @adapter = Inbox.adapter
        return if Adapters.available?(@adapter)

        render_error('unsupported', 'This store has no inbox.', :not_found)
      end

      def load_conversation
        @conversation = adapter_call(:conversation, params[:id].to_s)
        render_error('not_found', 'No such conversation.', :not_found) if @conversation.nil?
      end

      def conversation_filters
        status = (params[:status].presence || 'open').to_s
        assignee = (params[:assignee].presence || 'any').to_s
        fields = {}
        fields['status'] = ["must be one of #{Inbox::STATUS_FILTERS.join(', ')}"] unless Inbox::STATUS_FILTERS.include?(status)
        fields['assignee'] = ["must be one of #{Inbox::ASSIGNEE_FILTERS.join(', ')}"] unless Inbox::ASSIGNEE_FILTERS.include?(assignee)
        updated_since = nil
        if params[:updated_since].present?
          updated_since = Adapters.parse_time(params[:updated_since].to_s)
          fields['updated_since'] = ['must be an ISO 8601 time'] if updated_since.nil?
        end
        if fields.any?
          render_error('invalid', fields.map { |n, m| "#{n.humanize} #{m.first}" }.to_sentence, :unprocessable_entity, fields)
          return nil
        end

        { status: status, assignee: assignee, q: params[:q].to_s.strip.presence, page: page_param, per_page: per_page_param,
          updated_since: updated_since, admin: current_admin }
      end

      def update_attrs
        attrs = {}
        fields = {}
        if params.key?(:status)
          status = params[:status].to_s
          if Inbox::STATUSES.include?(status)
            attrs[:status] = status
          else
            fields['status'] = ["must be one of #{Inbox::STATUSES.join(', ')}"]
          end
        end
        if params.key?(:assignee_id)
          # 'me' is the signed-in admin, as in the list's assignee filter; the app doesn't know its id.
          assignee = params[:assignee_id].presence&.to_s
          attrs[:assignee_id] = assignee == 'me' ? current_admin.id.to_s : assignee
        end
        if params.key?(:snoozed_until)
          if params[:snoozed_until].blank?
            attrs[:snoozed_until] = nil
          elsif (time = Adapters.parse_time(params[:snoozed_until].to_s))
            attrs[:snoozed_until] = time
          else
            fields['snoozed_until'] = ['must be an ISO 8601 time']
          end
        end
        [attrs, fields]
      end

      def valid_upload?(signed_id)
        return false unless defined?(ActiveStorage::Blob)

        !ActiveStorage::Blob.find_signed(signed_id).nil?
      rescue ActiveSupport::MessageVerifier::InvalidSignature, ActiveRecord::RecordNotFound
        false
      end
    end
  end
end
