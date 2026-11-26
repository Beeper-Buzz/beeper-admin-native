module SpreeAdminNative
  # A one-time code an admin creates (QR or typed) to sign a device in without a password.
  class Pairing < ActiveRecord::Base
    self.table_name = 'spree_admin_native_pairings'

    belongs_to :owner, polymorphic: true
    belongs_to :device, class_name: 'SpreeAdminNative::Device', optional: true

    # Returns [pairing, plain_code].
    def self.start!(owner:)
      code = Tokens.pairing_code
      pairing = create!(owner: owner, code_digest: Tokens.digest(code),
                        expires_at: Time.current + SpreeAdminNative.config.pairing_ttl)
      [pairing, code]
    end

    # Single use: the row is locked, checked and marked used in one transaction.
    def self.redeem!(code:, device_name:, platform: nil)
      digest = Tokens.digest(Tokens.normalize_code(code))
      transaction do
        pairing = lock.find_by(code_digest: digest)
        return nil if pairing.nil? || pairing.used_at || pairing.expires_at < Time.current

        device, token = Device.issue!(owner: pairing.owner, name: device_name, platform: platform)
        pairing.update!(used_at: Time.current, device: device)
        [device, token]
      end
    end
  end
end
