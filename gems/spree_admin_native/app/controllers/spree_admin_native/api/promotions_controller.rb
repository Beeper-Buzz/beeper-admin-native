module SpreeAdminNative
  module Api
    # Promotions for Spree 4.2–4.3, whose API v1 only shows one promotion by id. Covers the common
    # case: a coupon code (or automatic promotion) giving a percentage or fixed amount off the order.
    # Promotions with other rules and actions are listed and editable, but their rules and actions
    # stay as Spree admin set them.
    class PromotionsController < BaseController
      before_action :require_admin!
      before_action :load_promotion, only: %i[show update]

      PER_PAGE_MAX = 100

      def index
        scope = Spree::Promotion.order(created_at: :desc)
        if params[:q].present?
          term = "%#{Spree::Promotion.sanitize_sql_like(params[:q].to_s.strip.downcase)}%"
          scope = scope.where('lower(name) LIKE :t OR lower(code) LIKE :t', t: term)
        end
        scope = filter_status(scope)
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, PER_PAGE_MAX) : 25
        page = [params[:page].to_i, 1].max
        total = scope.count
        rows = scope.offset((page - 1) * per_page).limit(per_page).includes(:promotion_actions)
        render json: { data: rows.map { |p| present(p) }, meta: { page: page, per_page: per_page, total_count: total } }
      end

      def show
        render json: { data: present(@promotion) }
      end

      def create
        promotion = Spree::Promotion.new(promotion_attributes)
        calculator = build_calculator(params.require(:discount))
        Spree::Promotion.transaction(requires_new: true) do
          promotion.save!
          apply_calculator!(promotion, calculator)
        end
        render json: { data: present(promotion.reload) }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render_error('invalid', e.record.errors.full_messages.to_sentence)
      rescue ArgumentError, ActionController::ParameterMissing => e
        render_error('invalid', e.message)
      end

      def update
        calculator = build_calculator(params[:discount]) if params[:discount].present?
        if calculator && !editable_discount?(@promotion)
          return render_error('invalid', "This promotion has actions the app can't edit; change its discount in Spree admin.")
        end

        Spree::Promotion.transaction(requires_new: true) do
          @promotion.update!(promotion_attributes)
          apply_calculator!(@promotion, calculator) if calculator
        end
        render json: { data: present(@promotion.reload) }
      rescue ActiveRecord::RecordInvalid => e
        render_error('invalid', e.record.errors.full_messages.to_sentence)
      rescue ArgumentError => e
        render_error('invalid', e.message)
      end

      private

      def load_promotion
        @promotion = Spree::Promotion.find(params[:id])
      end

      def filter_status(scope)
        now = Time.current
        case params[:status]
        when 'active'
          scope.where('starts_at IS NULL OR starts_at <= ?', now).where('expires_at IS NULL OR expires_at > ?', now)
        when 'scheduled' then scope.where('starts_at > ?', now)
        when 'expired' then scope.where('expires_at <= ?', now)
        else scope
        end
      end

      PERMITTED = %i[name description code starts_at expires_at usage_limit].freeze

      def promotion_attributes
        attrs = params.permit(*PERMITTED).to_h.symbolize_keys
        attrs[:code] = attrs[:code].presence if attrs.key?(:code)
        attrs[:usage_limit] = attrs[:usage_limit].presence if attrs.key?(:usage_limit)
        attrs
      end

      # discount: { type: 'percent' | 'fixed', amount: '10' }. Raises ArgumentError before anything
      # is saved when the discount is invalid.
      def build_calculator(discount)
        discount = discount.respond_to?(:permit) ? discount.permit(:type, :amount).to_h : discount.to_h
        amount = begin
          BigDecimal(discount['amount'].to_s)
        rescue ArgumentError
          raise ArgumentError, 'Discount amount must be a number.'
        end
        raise ArgumentError, 'Discount amount must be more than 0.' unless amount.positive?

        case discount['type']
        when 'percent'
          raise ArgumentError, 'A percentage discount can be at most 100.' if amount > 100

          Spree::Calculator::FlatPercentItemTotal.new(preferred_flat_percent: amount)
        when 'fixed'
          currency = Spree::Store.respond_to?(:default) ? Spree::Store.default&.default_currency : nil
          Spree::Calculator::FlatRate.new(preferred_amount: amount, preferred_currency: currency || Spree::Config[:currency])
        else
          raise ArgumentError, "Discount type must be 'percent' or 'fixed'."
        end
      end

      # Gives the promotion one order-level discount with this calculator, replacing the old one.
      def apply_calculator!(promotion, calculator)
        action = promotion.promotion_actions.first || Spree::Promotion::Actions::CreateAdjustment.new(promotion: promotion)
        action.calculator&.destroy if action.persisted?
        action.calculator = calculator
        action.save!
        promotion.promotion_actions.reset
      end

      def present(promotion)
        now = Time.current
        status =
          if promotion.starts_at && promotion.starts_at > now then 'scheduled'
          elsif promotion.expires_at && promotion.expires_at <= now then 'expired'
          else 'active'
          end
        {
          id: promotion.id.to_s,
          name: promotion.name,
          description: promotion.description,
          code: promotion.code,
          status: status,
          starts_at: promotion.starts_at&.iso8601,
          expires_at: promotion.expires_at&.iso8601,
          usage_limit: promotion.usage_limit,
          usage_count: promotion.respond_to?(:credits_count) ? promotion.credits_count : nil,
          discount: discount_of(promotion),
          editable_discount: editable_discount?(promotion),
          created_at: promotion.created_at&.iso8601,
          updated_at: promotion.updated_at&.iso8601
        }
      end

      def editable_discount?(promotion)
        actions = promotion.promotion_actions.to_a
        actions.empty? || (actions.size == 1 && actions.first.is_a?(Spree::Promotion::Actions::CreateAdjustment))
      end

      def discount_of(promotion)
        action = promotion.promotion_actions.find { |a| a.respond_to?(:calculator) && a.calculator }
        return nil unless action

        calc = action.calculator
        case calc
        when Spree::Calculator::FlatPercentItemTotal
          { type: 'percent', amount: calc.preferred_flat_percent.to_s }
        when Spree::Calculator::FlatRate
          { type: 'fixed', amount: calc.preferred_amount.to_s, currency: calc.preferred_currency }
        else
          { type: 'other', label: calc.class.respond_to?(:description) ? calc.class.description : calc.class.name.demodulize }
        end
      end

      def render_error(code, message)
        render json: { error: { code: code, message: message } }, status: :unprocessable_entity
      end
    end
  end
end
