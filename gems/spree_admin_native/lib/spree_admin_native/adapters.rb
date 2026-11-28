module SpreeAdminNative
  # A host adapter (inbox, visitors) failed or returned something the gem can't serialize. The API
  # answers 502 `adapter_failed`, never a 500 with a stack trace.
  class AdapterError < StandardError; end

  # An adapter refusing what the app sent (an unknown assignee, a closed conversation…): 422
  # `invalid` with the message.
  class AdapterInvalid < StandardError; end

  # Shared by the inbox and visitors adapters: resolving the configured adapter, calling it, and
  # checking and serializing the plain hashes it returns.
  module Adapters
    module_function

    # An adapter instance, a class (instantiated) or a class name (resolved on each use, so code
    # reloading works). nil when unset.
    def resolve(value)
      value = value.call if value.is_a?(Proc)
      value = value.to_s.safe_constantize if value.is_a?(String) || value.is_a?(Symbol)
      value = value.new if value.is_a?(Class)
      value
    end

    # Whether an adapter is set and says it is available. A raising adapter is not available.
    def available?(adapter)
      !adapter.nil? && !!adapter.available?
    rescue StandardError, NotImplementedError => e
      Rails.logger.warn("[spree_admin_native] #{adapter.class}#available?: #{e.class}: #{e.message}")
      false
    end

    # Runs an adapter method. Anything it raises besides a refusal becomes an AdapterError.
    def call(adapter, method)
      yield
    rescue AdapterInvalid, AdapterError, ActiveRecord::RecordNotFound
      raise
    rescue ActiveRecord::RecordInvalid => e
      raise AdapterInvalid, e.record.errors.full_messages.to_sentence.presence || e.message
    rescue StandardError, NotImplementedError => e
      Rails.logger.error("[spree_admin_native] #{adapter.class}##{method}: #{e.class}: #{e.message}")
      raise AdapterError, "The store's #{method.to_s.tr('_', ' ')} failed (#{e.class})."
    end

    # --- Shapes ------------------------------------------------------------------------------

    # A hash with indifferent access, or an AdapterError naming what was expected.
    def hash!(value, what)
      raise AdapterError, "The store returned #{value.class} for #{what}, not a hash." unless value.respond_to?(:to_hash)

      value.to_hash.with_indifferent_access
    end

    def hash_or_nil(value, what)
      value.nil? ? nil : hash!(value, what)
    end

    def require_keys!(hash, keys, what)
      missing = keys.map(&:to_s).select { |key| hash[key].nil? || (hash[key].is_a?(String) && hash[key].strip.empty?) }
      return hash if missing.empty?

      raise AdapterError, "The store's #{what} is missing #{missing.join(', ')}."
    end

    def array!(value, what)
      return [] if value.nil?
      raise AdapterError, "The store returned #{value.class} for #{what}, not a list." unless value.respond_to?(:to_ary)

      value.to_ary
    end

    # `{ records:, total: }` from a list method.
    def page!(value, what)
      result = hash!(value, what)
      records = array!(result[:records], "#{what} records")
      total = result[:total]
      raise AdapterError, "The store's #{what} is missing total." if total.nil?

      [records, int(total, "#{what} total")]
    end

    def id(value)
      value.nil? || value.to_s.empty? ? nil : value.to_s
    end

    def string(value)
      value.nil? ? nil : value.to_s
    end

    def int(value, what = 'a number')
      return nil if value.nil?
      return value if value.is_a?(Integer)
      return value.to_i if value.is_a?(Numeric) && value == value.to_i

      Integer(value.to_s, 10)
    rescue ArgumentError, TypeError
      raise AdapterError, "The store returned #{value.inspect} for #{what}, not a whole number."
    end

    def bool(value)
      value.nil? ? nil : ActiveModel::Type::Boolean.new.cast(value)
    end

    # ISO 8601 (UTC offset kept), from a time, a date or a string.
    def time(value, what = 'a time')
      case value
      when nil then nil
      when Time, DateTime, ActiveSupport::TimeWithZone then value.iso8601
      when Date then value.iso8601
      when String then value.strip.empty? ? nil : Time.iso8601(value.strip).iso8601
      when Numeric then Time.at(value).utc.iso8601
      else raise AdapterError, "The store returned #{value.inspect} for #{what}."
      end
    rescue ArgumentError
      raise AdapterError, "The store returned #{value.inspect} for #{what}, not an ISO 8601 time."
    end

    def parse_time(value)
      case value
      when nil then nil
      when Time, DateTime, ActiveSupport::TimeWithZone then value
      when String then Time.iso8601(value.strip)
      end
    rescue ArgumentError
      nil
    end

    # Money as a string with two decimals ("184.00"); strings pass through.
    def money(value)
      case value
      when nil then nil
      when String then value
      when Numeric then format('%.2f', value)
      else value.respond_to?(:to_d) ? format('%.2f', value.to_d) : value.to_s
      end
    end

    def one_of(value, allowed, what)
      return nil if value.nil?

      text = value.to_s
      raise AdapterError, "The store returned #{text.inspect} for #{what} (#{allowed.join(', ')})." unless allowed.include?(text)

      text
    end
  end
end
