namespace :spree_admin_native do
  desc 'Print a one-time pairing code for an admin (for headless setups and tests): rails "spree_admin_native:pairing_code[admin@example.com]"'
  task :pairing_code, [:email] => :environment do |_t, args|
    email = args[:email] || ENV['EMAIL']
    abort 'usage: rails "spree_admin_native:pairing_code[admin@example.com]"' if email.blank?

    owner_class = 'Spree::AdminUser'.safe_constantize || Spree.user_class
    owner = owner_class.find_by(email: email)
    abort "No user #{email}" unless owner

    _pairing, code = SpreeAdminNative::Pairing.start!(owner: owner)
    puts code
  end
end
