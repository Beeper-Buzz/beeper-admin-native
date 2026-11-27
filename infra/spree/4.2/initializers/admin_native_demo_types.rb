# Demo admin types for the Spree 4.2 test store, over Spree's own models, so the app's generic
# screens and packages/spree-sdk/contract/resources.contract.ts have something real to work on.
# A host app (dna-admin and its forks) writes the same kind of file for its own models: menus,
# homepage sections, push notifications…
#
# docker-compose.yml mounts this file into config/initializers/; it takes effect on a restart.
# The contract suite relies on the keys, actions, messages, inputs, filters and hooks below
# (docs/superpowers/specs/2026-11-27-admin-types-0.5.md, "Demo types").
if defined?(SpreeAdminNative) && SpreeAdminNative.respond_to?(:resources)
  SpreeAdminNative.resources.register 'refund_reasons' do |r|
    r.model 'Spree::RefundReason'
    r.label 'Refund reasons'
    r.singular 'Refund reason'
    r.group 'Payments'
    r.icon 'arrow.uturn.backward'
    r.title :name
    r.list :name, :active
    r.search :name
    r.filter :active
    r.order :name
    r.fields :auto, readonly: %i[mutable]
    r.field :name, required: true, hint: 'Shown to staff when they refund a payment.'
    r.field :active, default: true
    r.action :retire, label: 'Retire', confirm: 'Stop offering this reason for new refunds?', destructive: true,
                      if: ->(reason) { reason.active } do |reason, _admin|
      reason.update!(active: false)
      'Retired. Existing refunds keep it.'
    end
    r.action :reinstate, label: 'Offer again', if: ->(reason) { !reason.active } do |reason, _admin|
      reason.update!(active: true)
      'Offered again.'
    end
    r.action :rename, label: 'Rename',
                      inputs: [{ name: :new_name, type: :string, required: true, label: 'New name' }] do |reason, _admin, input|
      reason.update!(name: input[:new_name])
      'Renamed.'
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
    r.filter :description, :presence
    r.filter :created_at, :date_range
    r.order :name
    r.fields :auto, readonly: %i[zone_members_count]
    r.field :name, required: true
    r.field :kind, :enum, options: %w[country state], required: true
    r.field :default_tax, label: 'Default tax zone'
    # Only empty zones can be deleted; Discard removes one with its members.
    r.deletable_if ->(zone) { zone.zone_members.none? }
    r.action :discard, label: 'Discard', confirm: 'Delete this zone and its members?', destructive: true do |zone, _admin|
      zone.destroy!
      { message: 'Discarded.', removed: true }
    end
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
    r.filter :country_id
    r.order :name
    r.fields :auto
    r.field :name, required: true
    r.field :country_id, :reference, resource: 'countries', label: 'Country', required: true
  end

  # Product photos: alt text and the picture itself (an upload's signed_id) are editable; new
  # photos and deleting them stay in the products screens.
  SpreeAdminNative.resources.register 'product_images' do |r|
    r.model 'Spree::Image'
    r.label 'Product images'
    r.singular 'Product image'
    r.group 'Catalog'
    r.icon 'photo'
    r.title :alt
    r.list :alt, :viewable_id
    r.search :alt
    r.order :created_at, :desc
    r.field :alt, :string, label: 'Alt text'
    r.field :attachment, :image, label: 'Image'
    r.field :viewable_id, :integer, label: 'Variant id', readonly: true
    r.actions create: false, destroy: false
    r.editable_if ->(_image) { true }
    r.before_save do |image, _admin, _op|
      image.errors.add(:alt, "Alt text can't be blank") if image.alt.to_s.strip.empty?
    end
  end

  SpreeAdminNative.resources.register 'option_types' do |r|
    r.model 'Spree::OptionType'
    r.label 'Option types'
    r.singular 'Option type'
    r.group 'Catalog'
    r.icon 'slider.horizontal.3'
    r.title :presentation
    r.subtitle :name
    r.list :name, :position
    r.search :name
    r.order :position
    r.fields :auto
  end

  # A fork or an extension extends an inherited type like this, before or after it is
  # registered; here it runs after, adding a search on the presentation.
  SpreeAdminNative.resources.configure('option_types') do |r|
    r.search :name, :presentation
  end
end
