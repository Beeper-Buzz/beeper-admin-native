require 'net/http'
require 'json'

module SpreeAdminNative
  # Sends messages through the Expo Push API and forgets tokens Expo says are gone.
  class ExpoPush
    BATCH = 100

    def deliver(devices, title:, body:, data: {})
      devices = devices.to_a
      devices.each_slice(BATCH) do |batch|
        messages = batch.map { |d| { to: d.push_token, title: title, body: body, data: data, sound: 'default', priority: 'high' } }
        tickets = post(messages)
        batch.zip(tickets).each do |device, ticket|
          next unless ticket.is_a?(Hash) && ticket['status'] == 'error'
          next unless ticket.dig('details', 'error') == 'DeviceNotRegistered'

          device.update_column(:push_token, nil)
        end
      end
      devices.size
    end

    private

    def post(messages)
      uri = URI(SpreeAdminNative.config.expo_push_url)
      request = Net::HTTP::Post.new(uri)
      request['Content-Type'] = 'application/json'
      request['Accept'] = 'application/json'
      token = SpreeAdminNative.config.expo_access_token
      request['Authorization'] = "Bearer #{token}" if token.present?
      request.body = JSON.generate(messages)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 5, read_timeout: 10) do |http|
        http.request(request)
      end
      JSON.parse(response.body.to_s).fetch('data', [])
    rescue StandardError => e
      Rails.logger.warn("[spree_admin_native] push failed: #{e.class}: #{e.message}")
      []
    end
  end
end
