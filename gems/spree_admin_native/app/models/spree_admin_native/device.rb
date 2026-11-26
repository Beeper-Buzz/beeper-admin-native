module SpreeAdminNative
  class Device < ActiveRecord::Base
    self.table_name = 'spree_admin_native_devices'

    belongs_to :owner, polymorphic: true

    scope :active, -> { where(revoked_at: nil) }
    scope :pushable, -> { active.where(push_enabled: true).where.not(push_token: [nil, '']) }

    validates :name, presence: true
    validates :token_digest, presence: true, uniqueness: true

    # Returns [device, plain_token]. The plain token is shown once and never stored.
    def self.issue!(owner:, name:, platform: nil)
      token = Tokens.device_token
      device = create!(owner: owner, name: name.to_s.strip.presence || 'Device', platform: platform,
                       token_digest: Tokens.digest(token))
      [device, token]
    end

    def self.authenticate(token)
      return nil unless Tokens.device_token?(token)

      device = active.find_by(token_digest: Tokens.digest(token))
      return nil unless device

      # Cheap enough per request; skip writes within a minute to keep load low.
      device.update_column(:last_used_at, Time.current) if device.last_used_at.nil? || device.last_used_at < 1.minute.ago
      device
    end

    def revoke!
      update!(revoked_at: Time.current, push_token: nil)
    end

    def as_api_json
      {
        id: id.to_s, name: name, platform: platform, push_enabled: push_enabled,
        has_push_token: push_token.present?, last_used_at: last_used_at&.iso8601, created_at: created_at.iso8601
      }
    end
  end
end
