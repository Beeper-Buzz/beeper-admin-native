module SpreeAdminNative
  module Api
    class SummaryController < BaseController
      before_action :require_admin!

      def show
        render json: Summary.new.as_json
      end
    end
  end
end
