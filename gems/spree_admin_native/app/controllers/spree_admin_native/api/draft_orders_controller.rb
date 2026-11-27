module SpreeAdminNative
  module Api
    # Order creation on Spree 4.2–4.3. API v1 creates and completes orders, but it doesn't say which
    # payment methods need a card (its payment method JSON is id, name and description) and has no
    # way to delete an order, so a draft the merchant abandons would linger as an empty cart.
    class DraftOrdersController < BaseController
      before_action :require_admin!

      # Payment methods a merchant can record without card details (Check, cash, bank transfer):
      # active, offered in the back office, and with no source to collect.
      def payment_methods
        scope = Spree::PaymentMethod.respond_to?(:available_on_back_end) ? Spree::PaymentMethod.available_on_back_end : Spree::PaymentMethod.active
        store = default_store
        methods = scope.to_a.select do |m|
          !m.source_required? && (store.nil? || !m.respond_to?(:available_for_store?) || m.available_for_store?(store))
        end
        render json: { data: methods.map { |m| { id: m.id.to_s, name: m.name, description: m.description.presence } } }
      end

      # Deletes a draft a staff member started. Placed orders are canceled, never deleted, and a
      # shopper's cart is left alone.
      def destroy
        order = Spree::Order.find_by!(number: params[:order_number])
        if order.completed?
          return render_error('order_placed', "Order #{order.number} has been placed; cancel it instead.")
        end
        unless order.respond_to?(:created_by) && order.created_by && admin?(order.created_by)
          return render_error('not_a_draft', "Order #{order.number} wasn't started by staff; it is a shopper's cart.")
        end

        order.destroy!
        head :no_content
      end

      private

      def default_store
        Spree::Store.respond_to?(:default) ? Spree::Store.default : Spree::Store.first
      end

      def render_error(code, message)
        render json: { error: { code: code, message: message } }, status: :unprocessable_entity
      end
    end
  end
end
