module SpreeAdminNative
  module Api
    # Public: tells the app what this store can do before anyone signs in.
    class CapabilitiesController < BaseController
      def show
        store = Spree::Store.respond_to?(:default) ? Spree::Store.default : Spree::Store.first
        body = {
          api_families: api_families,
          capabilities: capabilities,
          auth_methods: pairing_available? ? %w[pairing] : [],
          store: { name: store&.name, currency: store&.default_currency }
        }
        if SpreeAdminNative.config.expose_versions
          body[:spree_version] = spree_version
          body[:gem_version] = SpreeAdminNative::VERSION
        end
        render json: body
      end

      private

      def capabilities
        list = %w[notifications.push analytics.summary orders.refund]
        # Coupon codes live on the promotion until Spree 5 moved them to their own table.
        list += %w[promotions.read promotions.write] if Spree::Promotion.column_names.include?('code')
        list + SpreeAdminNative.config.extra_capabilities
      end

      def api_families
        {
          'admin-v3' => 'Spree::Api::V3::Admin::OrdersController',
          'platform-v2' => 'Spree::Api::V2::Platform::OrdersController',
          'api-v1' => 'Spree::Api::V1::OrdersController'
        }.select { |_family, klass| klass.safe_constantize }.keys
      end

      def pairing_available?
        'Spree::Admin::AdminNativeDevicesController'.safe_constantize.present?
      end

      def spree_version
        Spree.respond_to?(:version) ? Spree.version : Gem.loaded_specs['spree_core']&.version.to_s
      end
    end
  end
end
