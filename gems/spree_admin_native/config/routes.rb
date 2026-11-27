SpreeAdminNative::Engine.routes.draw do
  scope 'api/admin_native/v1', module: 'api', defaults: { format: :json } do
    get 'capabilities', to: 'capabilities#show'
    get 'pair', to: 'pairings#show'
    post 'pairings/exchange', to: 'pairings#exchange'
    get 'devices', to: 'devices#index'
    patch 'devices/current', to: 'devices#update_current'
    delete 'devices/:id', to: 'devices#destroy'
    get 'summary', to: 'summary#show'
    get 'refund_reasons', to: 'refunds#reasons'
    post 'orders/:order_number/payments/:payment_number/refunds', to: 'refunds#create'
    resources :promotions, only: %i[index show create update]
  end
end

# The pairing page lives in Spree's Rails admin (4.x/5.x), next to Spree's own admin routes.
if 'Spree::Admin::BaseController'.safe_constantize && Spree::Core::Engine.respond_to?(:add_routes)
  Spree::Core::Engine.add_routes do
    namespace :admin, path: Spree.admin_path do
      resources :admin_native_devices, only: %i[index destroy] do
        collection { post :pair }
      end
    end
  end
end
