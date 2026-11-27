class CreateSpreeAdminNativeTables < ActiveRecord::Migration[6.1]
  # Idempotent: a host app that copies this migration again under a new timestamp (Docker images
  # that install the bind-mounted gem's migrations at every boot) must not fail on existing tables.
  def change
    create_table :spree_admin_native_devices, if_not_exists: true do |t|
      # Polymorphic: Spree 4.x admins are Spree::User, Spree 5+/6 admins are Spree::AdminUser.
      t.references :owner, polymorphic: true, null: false, index: true
      t.string :name, null: false
      t.string :platform
      t.string :token_digest, null: false
      t.string :push_token
      t.boolean :push_enabled, null: false, default: true
      t.datetime :last_used_at
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :spree_admin_native_devices, :token_digest, unique: true, if_not_exists: true

    create_table :spree_admin_native_pairings, if_not_exists: true do |t|
      t.references :owner, polymorphic: true, null: false, index: true
      t.string :code_digest, null: false
      t.datetime :expires_at, null: false
      t.datetime :used_at
      t.references :device, index: false
      t.timestamps
    end
    add_index :spree_admin_native_pairings, :code_digest, unique: true, if_not_exists: true
  end
end
