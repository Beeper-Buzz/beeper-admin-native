module SpreeAdminNative
  module Api
    class SummaryController < BaseController
      before_action :require_admin!

      def show
        render json: Summary.new(admin: current_admin).as_json
      end

      # Products with low-stock variants, lowest first (the same set the summary counts).
      def low_stock
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, 100) : 25
        page = [params[:page].to_i, 1].max
        rows, total = LowStock.products(page: page, per_page: per_page)
        render json: { data: rows, meta: { page: page, per_page: per_page, total_count: total, threshold: LowStock.threshold } }
      end
    end
  end
end
