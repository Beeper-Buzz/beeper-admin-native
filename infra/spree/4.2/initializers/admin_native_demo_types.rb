# Demo admin types for the Spree 4.2 test store, over Spree's own models, so the app's generic
# screens and packages/spree-sdk/contract/resources.contract.ts have something real to work on.
# A host app (dna-admin and its forks) writes the same kind of file for its own models: menus,
# homepage sections, push notifications…
#
# docker-compose.yml mounts this file into config/initializers/; it takes effect on a restart.
if defined?(SpreeAdminNative) && SpreeAdminNative.respond_to?(:resources)
  SpreeAdminNative.resources.register 'refund_reasons' do |r|
    r.model 'Spree::RefundReason'
    r.label 'Refund reasons'
    r.group 'Payments'
    r.icon 'arrow.uturn.backward'
    r.title :name
    r.list :name, :active
    r.search :name
    r.filter :active
    r.order :name
    r.fields :auto, readonly: %i[mutable]
    r.field :name, required: true, hint: 'Shown to staff when they refund a payment.'
    r.action :retire, label: 'Retire', confirm: 'Stop offering this reason for new refunds?', destructive: true,
                      if: ->(reason) { reason.active } do |reason, _admin|
      reason.update!(active: false)
      'Retired. Existing refunds keep it.'
    end
    r.action :reinstate, label: 'Offer again', if: ->(reason) { !reason.active } do |reason, _admin|
      reason.update!(active: true)
      'Offered again.'
    end
  end

  SpreeAdminNative.resources.register 'zones' do |r|
    r.model 'Spree::Zone'
    r.label 'Zones'
    r.group 'Shipping'
    r.icon 'globe'
    r.title :name
    r.subtitle :description
    r.list :name, :kind, :default_tax
    r.search :name, :description
    r.filter :kind, %w[country state]
    r.order :name
    r.fields :auto, readonly: %i[zone_members_count]
    r.field :name, required: true
    r.field :kind, :enum, options: %w[country state], required: true
    r.field :default_tax, label: 'Default tax zone'
  end

  # Read-only: listed so a state's country can be picked.
  SpreeAdminNative.resources.register 'countries' do |r|
    r.model 'Spree::Country'
    r.label 'Countries'
    r.group 'Shipping'
    r.icon 'flag'
    r.title :name
    r.subtitle :iso
    r.list :iso3, :states_required
    r.search :name, :iso
    r.filter :states_required
    r.order :name
    r.fields :auto
    r.actions create: false, update: false, destroy: false
  end

  SpreeAdminNative.resources.register 'states' do |r|
    r.model 'Spree::State'
    r.label 'States'
    r.group 'Shipping'
    r.icon 'mappin.and.ellipse'
    r.title :name
    r.subtitle :abbr
    r.list :country_id
    r.search :name, :abbr
    r.order :name
    r.fields :auto
    r.field :name, required: true
    r.field :country_id, :reference, resource: 'countries', label: 'Country', required: true
  end
end
