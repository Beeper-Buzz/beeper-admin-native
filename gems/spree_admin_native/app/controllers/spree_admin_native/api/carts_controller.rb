module SpreeAdminNative
  module Api
    # Shoppers' carts (SpreeAdminNative::Carts), built in for every Spree store.
    class CartsController < BaseController
      before_action :require_admin!

      PER_PAGE_MAX = 100

      # GET carts?active_within=<minutes>&with_email=true|false&abandoned=true|false&page=&per_page=
      def index
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, PER_PAGE_MAX) : 25
        page = [params[:page].to_i, 1].max
        active_within = params[:active_within].presence && params[:active_within].to_i
        if active_within && active_within <= 0
          return render json: { error: { code: 'invalid', message: 'Active within must be a number of minutes.',
                                         fields: { 'active_within' => ['must be greater than 0'] } } },
                        status: :unprocessable_entity
        end

        now = Time.current
        rows, total = Carts.list(page: page, per_page: per_page, active_within: active_within,
                                 with_email: boolean_param(:with_email), abandoned: boolean_param(:abandoned), now: now)
        render json: { data: rows.map { |order| Carts.as_json(order, url_for: image_url_builder, now: now) },
                       meta: { page: page, per_page: per_page, total_count: total } }
      end

      # GET carts/:number
      def show
        order = Carts.find(params[:number])
        return render json: { error: { code: 'not_found', message: 'No such cart.' } }, status: :not_found unless order

        render json: { data: Carts.as_json(order, url_for: image_url_builder) }
      end

      private

      def boolean_param(name)
        value = params[name]
        value.nil? || value.to_s.strip.empty? ? nil : ActiveModel::Type::Boolean.new.cast(value)
      end

      def image_url_builder
        lambda do |rendition|
          Rails.application.routes.url_helpers.polymorphic_url(rendition, host: request.host_with_port, protocol: request.protocol)
        end
      end
    end
  end
end
