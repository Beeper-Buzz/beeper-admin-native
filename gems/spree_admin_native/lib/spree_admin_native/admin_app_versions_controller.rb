# Loaded only when Spree's Rails admin is present (see Engine#to_prepare). The forms live in the
# App versions section of the admin app page (admin_native_devices#index).
module Spree
  module Admin
    class AdminNativeAppVersionsController < Spree::Admin::BaseController
      before_action :require_gate
      before_action :load_app_version

      # Creates or updates the platform's row; clearing both versions and the link deletes it.
      def update
        @app_version.assign_attributes(app_version_params)
        if @app_version.cleared?
          @app_version.destroy! if @app_version.persisted?
          flash[:success] = "#{@app_version.label} app versions cleared."
          return redirect_to app_versions_section
        end

        if @app_version.save
          flash[:success] = "#{@app_version.label} app versions saved."
          redirect_to app_versions_section
        else
          @devices = SpreeAdminNative::Device.active.where(owner: try_spree_current_user).order(created_at: :desc)
          @app_versions = SpreeAdminNative::AppVersion.forms.merge(@app_version.platform => @app_version)
          render 'spree/admin/admin_native_devices/index', status: :unprocessable_entity
        end
      end

      def destroy
        @app_version.destroy! if @app_version.persisted?
        flash[:success] = "#{@app_version.label} app versions cleared."
        redirect_to app_versions_section
      end

      private

      def model_class
        SpreeAdminNative::AppVersion
      end

      def require_gate
        raise ActionController::RoutingError, 'Not Found' unless SpreeAdminNative::AppVersion.enabled?
      end

      def load_app_version
        @app_version = SpreeAdminNative::AppVersion.find_or_initialize_by(platform: params[:platform])
      end

      def app_version_params
        permitted = %i[minimum_version recommended_version update_url]
        permitted << :allow_ahead_of_store if @app_version.app_store_checked?
        params.fetch(:app_version, {}).permit(*permitted)
      end

      def app_versions_section
        "#{admin_admin_native_devices_path}#app-versions"
      end
    end
  end
end
