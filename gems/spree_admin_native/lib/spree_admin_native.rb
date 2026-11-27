require 'spree_core'
require 'spree_admin_native/version'
require 'spree_admin_native/configuration'
require 'spree_admin_native/tokens'
require 'spree_admin_native/engine'
require 'spree_admin_native/resources'

module SpreeAdminNative
  class << self
    def config
      @config ||= Configuration.new
    end

    def configure
      yield config
    end

    # Stores that lock accounts (e.g. dna-admin's moderation) expose account_locked?; a locked
    # admin's paired devices stop working with everything else they hold.
    def locked?(user)
      user.respond_to?(:account_locked?) && user.account_locked?
    end

    # Extensions announce what they add so the app can show matching features
    # (e.g. SpreeAdminNative.register_capability('beeper.moderation')).
    def register_capability(name)
      config.extra_capabilities << name.to_s unless config.extra_capabilities.include?(name.to_s)
    end
  end
end
