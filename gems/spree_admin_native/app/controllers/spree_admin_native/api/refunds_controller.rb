module SpreeAdminNative
  module Api
    # Refunds for Spree 4.2–4.3. API v1 routes payments/:id/credit to an action that doesn't exist,
    # so this creates a Spree::Refund the way the Rails admin's refund form does: the payment
    # method credits the gateway, and the order's payment state is recalculated.
    class RefundsController < BaseController
      before_action :require_admin!

      def reasons
        render json: { data: Spree::RefundReason.active.order(:name).map { |r| { id: r.id.to_s, name: r.name } } }
      end

      def create
        order = Spree::Order.find_by!(number: params[:order_number])
        payment = order.payments.find_by!(number: params[:payment_number])
        reason = refund_reason
        unless reason
          return render_error('no_refund_reason', 'Add a refund reason in Spree admin (Configuration → Refund Reasons) first.')
        end

        refund = payment.refunds.build(amount: params.require(:amount), reason: reason)
        if refund.save
          order.reload
          render json: { refund: present(refund), order: { number: order.number, payment_state: order.payment_state } },
                 status: :created
        else
          render_error('invalid', refund.errors.full_messages.to_sentence)
        end
      rescue Spree::Core::GatewayError => e
        render_error('gateway_error', e.message)
      rescue ActionController::ParameterMissing
        render_error('invalid', 'Amount is required.')
      end

      private

      def refund_reason
        return Spree::RefundReason.active.find(params[:reason_id]) if params[:reason_id].present?

        Spree::RefundReason.return_processing_reason || Spree::RefundReason.active.order(:id).first
      end

      def present(refund)
        {
          id: refund.id.to_s,
          amount: refund.amount.to_s,
          currency: refund.payment.currency,
          reason: refund.reason&.name,
          payment_number: refund.payment.number,
          transaction_id: refund.transaction_id,
          created_at: refund.created_at&.iso8601
        }
      end

      def render_error(code, message)
        render json: { error: { code: code, message: message } }, status: :unprocessable_entity
      end
    end
  end
end
