require_relative 'lib/spree_admin_native/version'

Gem::Specification.new do |s|
  s.name        = 'spree_admin_native'
  s.version     = SpreeAdminNative::VERSION
  s.summary     = 'Companion gem for the Spree Admin Native app: QR device pairing, push notifications for new orders, dashboard summary.'
  s.description = 'Adds device pairing, per-device revocable tokens, Expo push notifications and a capabilities/summary API to any Spree store from 4.2 up, for the open-source Spree Admin Native mobile app.'
  s.authors     = ['Spree Admin Native contributors']
  s.homepage    = 'https://github.com/1instinct/spree-admin-native'
  s.license     = 'MIT'
  s.metadata    = { 'source_code_uri' => 'https://github.com/1instinct/spree-admin-native/tree/main/gems/spree_admin_native' }

  s.required_ruby_version = '>= 2.7'
  s.files = Dir['{app,config,db,lib}/**/*', 'README.md', 'LICENSE']

  s.add_dependency 'spree_core', '>= 4.2'
  s.add_dependency 'rqrcode', '>= 2.0', '< 4'
end
