module SpreeAdminNative
  module Api
    # Storefront sessions through the host's visitors adapter (SpreeAdminNative::Visitors::Adapter).
    class VisitorsController < BaseController
      include AdapterEndpoints

      before_action :load_adapter
      before_action :load_session, only: %i[show start_conversation]

      # GET visitors?online=true&page=&per_page=
      def index
        filters = { online: boolean_param(:online), page: page_param, per_page: per_page_param, admin: current_admin }
        records, total = Adapters.page!(adapter_call(:sessions, filters), 'visitor sessions')
        render json: { data: records.map { |s| Visitors.session_json(s) },
                       meta: { page: filters[:page], per_page: filters[:per_page], total_count: total } }
      end

      # GET visitors/:id
      def show
        render json: { data: Visitors.session_json(@session, pages: true) }
      end

      # POST visitors/:id/conversation. `data` is the canonical place; conversation_id is repeated
      # at the top level.
      def start_conversation
        result = adapter_call(:start_conversation, @session, current_admin)
        id =
          if result.respond_to?(:to_hash)
            hash = result.to_hash.with_indifferent_access
            hash[:conversation_id] || hash[:id]
          else
            result
          end
        raise AdapterError, "The store's start conversation returned no conversation_id." if Adapters.id(id).nil?

        render json: { data: { conversation_id: id.to_s }, conversation_id: id.to_s }
      end

      private

      def load_adapter
        @adapter = Visitors.adapter
        return if Adapters.available?(@adapter)

        render_error('unsupported', 'This store has no visitor tracking.', :not_found)
      end

      def load_session
        @session = adapter_call(:session, params[:id].to_s)
        render_error('not_found', 'No such visitor.', :not_found) if @session.nil?
      end
    end
  end
end
