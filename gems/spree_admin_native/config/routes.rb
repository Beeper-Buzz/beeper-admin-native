SpreeAdminNative::Engine.routes.draw do
  scope 'api/admin_native/v1', module: 'api', defaults: { format: :json } do
    get 'capabilities', to: 'capabilities#show'
    get 'app_version', to: 'app_versions#show'
    get 'pair', to: 'pairings#show'
    post 'pairings/exchange', to: 'pairings#exchange'
    get 'devices', to: 'devices#index'
    patch 'devices/current', to: 'devices#update_current'
    delete 'devices/:id', to: 'devices#destroy'
    get 'summary', to: 'summary#show'
    get 'resources', to: 'resources#index'
    post 'resources/uploads', to: 'resources#upload'
    get 'resources/:key', to: 'resources#list'
    post 'resources/:key', to: 'resources#create'
    get 'resources/:key/:id', to: 'resources#show'
    patch 'resources/:key/:id', to: 'resources#update'
    delete 'resources/:key/:id', to: 'resources#destroy'
    post 'resources/:key/:id/actions/:action_key', to: 'resources#perform'
    get 'low_stock', to: 'summary#low_stock'
    get 'media', to: 'media#index'
    get 'refund_reasons', to: 'refunds#reasons'
    post 'orders/:order_number/payments/:payment_number/refunds', to: 'refunds#create'
    resources :promotions, only: %i[index show create update]
    get 'payment_methods', to: 'draft_orders#payment_methods'
    delete 'orders/:order_number', to: 'draft_orders#destroy'
  end
end

# The pairing page lives in Spree's Rails admin (4.x/5.x), next to Spree's own admin routes.
if 'Spree::Admin::BaseController'.safe_constantize && Spree::Core::Engine.respond_to?(:add_routes)
  Spree::Core::Engine.add_routes do
    namespace :admin, path: Spree.admin_path do
      resources :admin_native_devices, only: %i[index destroy] do
        collection { post :pair }
      end
      # Keyed by platform (ios, android, all): saving creates or updates that platform's row.
      resources :admin_native_app_versions, only: %i[update destroy], param: :platform,
                                            constraints: { platform: /ios|android|all/ }
    end
  end
end
