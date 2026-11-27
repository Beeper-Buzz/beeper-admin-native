module SpreeAdminNative
  module Api
    # Public: an outdated app has to reach it before anyone signs in, and it tells nothing but
    # version numbers and the store link.
    class AppVersionsController < BaseController
      def show
        unless AppVersion.enabled?
          return render json: { error: { code: 'not_found', message: 'The app version gate is off.' } }, status: :not_found
        end

        render json: { data: AppVersion.status(params[:platform], params[:version]) }
      end
    end
  end
end
