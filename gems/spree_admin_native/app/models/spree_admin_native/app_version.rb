require 'net/http'
require 'json'

module SpreeAdminNative
  # The admin app's version gate: per platform, the oldest version the store accepts and the one it
  # asks people to update to, plus where the Update button goes. One row per platform; `all` covers
  # every platform without its own row.
  class AppVersion < ActiveRecord::Base
    self.table_name = 'spree_admin_native_app_versions'

    PLATFORMS = %w[ios android all].freeze
    LABELS = { 'ios' => 'iOS', 'android' => 'Android', 'all' => 'All' }.freeze
    # Rows whose versions must be live on the App Store (unless allow_ahead_of_store).
    APP_STORE_PLATFORMS = %w[ios all].freeze
    FORMAT = /\A\d+\.\d+\.\d+\z/.freeze
    # What the app sends: 1.2 means 1.2.0, and prerelease or build tags are dropped (1.2.3-beta.1 is 1.2.3).
    INSTALLED_FORMAT = /\A(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.+-]*)?\z/.freeze
    NO_MINIMUM = Gem::Version.new('0.0.0')
    APP_STORE_LOOKUP_URL = 'https://itunes.apple.com/lookup'.freeze
    APP_STORE_TIMEOUT = 5

    before_validation :normalize_blanks

    validates :platform, inclusion: { in: PLATFORMS }, uniqueness: true
    validates :minimum_version, :recommended_version,
              format: { with: FORMAT, message: 'must be a version like 1.2.3', allow_nil: true }
    validate :recommended_at_or_above_minimum
    validate :update_url_is_https
    validate :versions_live_on_the_app_store

    HUMAN_NAMES = { 'update_url' => 'Update link', 'allow_ahead_of_store' => 'Allow ahead of the App Store' }.freeze

    class << self
      # "Update link must be an https link", as the admin page labels it.
      def human_attribute_name(attribute, options = {})
        HUMAN_NAMES.fetch(attribute.to_s) { super }
      end

      # The gate is on and its table exists (no table before the migration, no database at asset precompile).
      def enabled?
        SpreeAdminNative.config.app_version_gate != false && table_exists?
      rescue StandardError
        false
      end

      # The row a platform reads: its own, else the `all` row, else nil. Unknown platforms read `all`.
      def effective_row(platform)
        key = platform.to_s.strip.downcase
        rows = where(platform: [key, 'all'].uniq).index_by(&:platform)
        (PLATFORMS.include?(key) && rows[key]) || rows['all']
      end

      def effective(platform)
        row = effective_row(platform)
        { minimum_version: row&.minimum_version, recommended_version: row&.recommended_version, update_url: row&.update_url }
      end

      # The endpoint's data: the effective settings and, when `version` parses, whether it is below them.
      def status(platform, version)
        settings = effective(platform)
        installed = parse_installed(version)
        minimum = parse(settings[:minimum_version])
        recommended = parse(settings[:recommended_version])
        settings.merge(
          update_required: !installed.nil? && !minimum.nil? && minimum > NO_MINIMUM && installed < minimum,
          update_recommended: !installed.nil? && !recommended.nil? && installed < recommended
        )
      end

      # Each platform's saved row, or a new one, for the admin page's forms.
      def forms
        rows = where(platform: PLATFORMS).index_by(&:platform)
        PLATFORMS.map { |p| [p, rows[p] || new(platform: p)] }.to_h
      end

      def parse(value)
        value = value.to_s.strip
        FORMAT.match?(value) ? Gem::Version.new(value) : nil
      end

      def parse_installed(value)
        match = INSTALLED_FORMAT.match(value.to_s.strip)
        match ? Gem::Version.new([match[1], match[2] || 0, match[3] || 0].join('.')) : nil
      end

      # The version the App Store serves for a bundle id, or nil when the lookup fails or finds nothing.
      def app_store_version(bundle_id)
        uri = URI(APP_STORE_LOOKUP_URL)
        uri.query = URI.encode_www_form(bundleId: bundle_id)
        response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https',
                                                       open_timeout: APP_STORE_TIMEOUT, read_timeout: APP_STORE_TIMEOUT) do |http|
          http.request(Net::HTTP::Get.new(uri))
        end
        return nil unless response.is_a?(Net::HTTPSuccess)

        result = Array(JSON.parse(response.body.to_s)['results']).first
        version = result.is_a?(Hash) ? result['version'].to_s.strip : ''
        !version.empty? && Gem::Version.correct?(version) ? version : nil
      rescue StandardError
        nil
      end
    end

    def label
      LABELS.fetch(platform, platform.to_s)
    end

    # Nothing left to keep: the admin page deletes the row instead of saving it.
    def cleared?
      minimum_version.blank? && recommended_version.blank? && update_url.blank?
    end

    def app_store_checked?
      APP_STORE_PLATFORMS.include?(platform)
    end

    private

    def normalize_blanks
      self.minimum_version = minimum_version.to_s.strip.presence
      self.recommended_version = recommended_version.to_s.strip.presence
      self.update_url = update_url.to_s.strip.presence
    end

    def recommended_at_or_above_minimum
      minimum = self.class.parse(minimum_version)
      recommended = self.class.parse(recommended_version)
      return unless minimum && recommended && recommended < minimum

      errors.add(:recommended_version, "can't be below the minimum version (#{minimum_version})")
    end

    def update_url_is_https
      return if update_url.nil?

      uri = URI.parse(update_url)
      return if uri.is_a?(URI::HTTPS) && uri.host.present?

      errors.add(:update_url, 'must be an https link')
    rescue URI::InvalidURIError
      errors.add(:update_url, 'must be an https link')
    end

    # Versions above what the App Store serves would lock everyone out (minimum) or nag them about
    # an update they can't get (recommended). Checked only when the versions or the box change, so
    # editing the link alone doesn't need the App Store.
    def versions_live_on_the_app_store
      return unless app_store_checked? && !allow_ahead_of_store
      return unless new_record? || will_save_change_to_minimum_version? ||
                    will_save_change_to_recommended_version? || will_save_change_to_allow_ahead_of_store?

      bundle_id = SpreeAdminNative.config.ios_bundle_id.to_s.strip
      return if bundle_id.empty?

      checked = { minimum_version: minimum_version, recommended_version: recommended_version }.select do |_attr, value|
        version = self.class.parse(value)
        version && version > NO_MINIMUM
      end
      return if checked.empty?

      live = self.class.app_store_version(bundle_id)
      if live.nil?
        errors.add(:base, "The App Store has no live version of #{bundle_id}, or couldn't be reached. " \
                          'Tick "Allow ahead of the App Store" to save a version that is in review or on TestFlight.')
        return
      end
      checked.each do |attr, value|
        next unless Gem::Version.new(value) > Gem::Version.new(live)

        errors.add(attr, "is above #{live}, the version live on the App Store. " \
                         'Tick "Allow ahead of the App Store" if it is in review or on TestFlight.')
      end
    end
  end
end
