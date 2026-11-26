require 'spree_core'
require 'spree_admin_native/version'
require 'spree_admin_native/configuration'
require 'spree_admin_native/tokens'
require 'spree_admin_native/engine'

module SpreeAdminNative
  class << self
    def config
      @config ||= Configuration.new
    end

    def configure
      yield config
    end

    # Extensions announce what they add so the app can show matching features
    # (e.g. SpreeAdminNative.register_capability('beeper.moderation')).
    def register_capability(name)
      config.extra_capabilities << name.to_s unless config.extra_capabilities.include?(name.to_s)
    end
  end
end
