require 'securerandom'
require 'digest'

module SpreeAdminNative
  # Secrets are never stored, only their SHA-256 digests.
  module Tokens
    DEVICE_PREFIX = 'san_'.freeze
    # Crockford-style alphabet without 0/O/1/I/L/U, easy to read aloud and type.
    CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'.chars.freeze

    module_function

    def digest(secret)
      Digest::SHA256.hexdigest(secret.to_s)
    end

    def device_token
      DEVICE_PREFIX + SecureRandom.urlsafe_base64(30)
    end

    def device_token?(value)
      value.is_a?(String) && value.start_with?(DEVICE_PREFIX)
    end

    # 12 characters from a 30-symbol alphabet: about 59 bits, valid for minutes, single use.
    def pairing_code
      Array.new(12) { CODE_ALPHABET[SecureRandom.random_number(CODE_ALPHABET.size)] }.join
    end

    def normalize_code(value)
      value.to_s.upcase.gsub(/[^A-Z0-9]/, '')
    end
  end
end
