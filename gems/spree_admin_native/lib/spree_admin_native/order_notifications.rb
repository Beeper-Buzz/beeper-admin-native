module SpreeAdminNative
  # Push a notification once, when an order is completed. after_commit, so a rolled-back
  # checkout never notifies.
  module OrderNotifications
    def self.included(base)
      base.after_commit :admin_native_notify_new_order, on: :update, if: :admin_native_just_completed?
    end

    private

    def admin_native_just_completed?
      saved_change_to_completed_at? && completed_at.present? && completed_at_before_last_save.nil?
    end

    def admin_native_notify_new_order
      SpreeAdminNative::PushJob.perform_later('order.completed', id)
    rescue StandardError => e
      Rails.logger.warn("[spree_admin_native] could not enqueue push for order #{id}: #{e.class}: #{e.message}")
    end
  end
end
