module SpreeAdminNative
  class Engine < ::Rails::Engine
    isolate_namespace SpreeAdminNative
    engine_name 'spree_admin_native'

    initializer 'spree_admin_native.routes', before: :add_routing_paths do |app|
      app.routes.prepend do
        mount SpreeAdminNative::Engine, at: '/', as: 'spree_admin_native'
      end
    end

    # Spree stores calculator settings (promotion discounts, shipping rates) as YAML. Rails 6.1.6.1+
    # only loads permitted classes from YAML columns, and decimal settings are BigDecimal, so without
    # this a percent or fixed discount saves but can't be read back (in Spree's admin too). Adds
    # BigDecimal to whatever the app already permits; turn off with
    # SpreeAdminNative.config.permit_bigdecimal_yaml = false.
    initializer 'spree_admin_native.yaml_bigdecimal', after: 'active_record.initialize_database' do
      ActiveSupport.on_load(:active_record) do
        next unless SpreeAdminNative.config.permit_bigdecimal_yaml

        owner = if ActiveRecord.respond_to?(:yaml_column_permitted_classes) then ActiveRecord
                elsif ActiveRecord::Base.respond_to?(:yaml_column_permitted_classes) then ActiveRecord::Base
                end
        next unless owner
        next if owner.yaml_column_permitted_classes.include?(BigDecimal)

        owner.yaml_column_permitted_classes = owner.yaml_column_permitted_classes + [BigDecimal]
      end
    end

    config.to_prepare do
      # Device tokens (san_…) authenticate on Spree's API v1, so the app's existing
      # X-Spree-Token client works unchanged.
      api_base = 'Spree::Api::BaseController'.safe_constantize
      if api_base && !(api_base < SpreeAdminNative::ApiV1DeviceAuth)
        api_base.prepend(SpreeAdminNative::ApiV1DeviceAuth)
      end

      unless Spree::Order < SpreeAdminNative::OrderNotifications
        Spree::Order.include(SpreeAdminNative::OrderNotifications)
      end

      # The pairing page needs Spree's Rails admin (4.x spree_backend, 5.x spree_admin).
      if 'Spree::Admin::BaseController'.safe_constantize
        load File.expand_path('admin_devices_controller.rb', __dir__)
      end
    end
  end
end

require 'spree_admin_native/api_v1_device_auth'
require 'spree_admin_native/order_notifications'
