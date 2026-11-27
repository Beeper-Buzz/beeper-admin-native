module SpreeAdminNative
  module Api
    # The store's product images in one list (Spree 4.x has no media library). Uploads, edits and
    # deletes stay on Spree's own API v1 (/api/v1/products/:id/images, /api/v1/variants/:id/images).
    class MediaController < BaseController
      before_action :require_admin!

      STYLES = %i[mini product large].freeze

      def index
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, 100) : 25
        page = [params[:page].to_i, 1].max
        missing_alt = ActiveModel::Type::Boolean.new.cast(params[:missing_alt]) || false
        images, total = MediaLibrary.images(query: params[:q], missing_alt: missing_alt, page: page, per_page: per_page)
        render json: { data: images.map { |image| image_json(image) },
                       meta: { page: page, per_page: per_page, total_count: total } }
      end

      private

      def image_json(image)
        body = {
          id: image.id.to_s,
          product_id: image.product_id.to_s,
          product_name: image.product_name,
          # Images on the master show for every variant; others belong to one variant.
          variant_id: image.on_master ? nil : image.viewable_id.to_s,
          alt: image.alt.presence,
          position: image.position
        }
        STYLES.each { |style| body[:"#{style}_url"] = style_url(image, style) }
        body
      end

      # The same resized renditions Spree's API v1 image views link to.
      def style_url(image, style)
        return nil unless image.attachment.attached?

        Rails.application.routes.url_helpers.polymorphic_url(
          image.url(style), host: request.host_with_port, protocol: request.protocol
        )
      end
    end
  end
end
