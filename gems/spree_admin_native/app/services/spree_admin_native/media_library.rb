module SpreeAdminNative
  # Every product image in the store, newest first. Spree 4.x API v1 only lists one product's (or
  # one variant's) images at a time, and can't search them by product or find the ones without
  # alt text, which a store-wide media screen needs.
  module MediaLibrary
    module_function

    # Images on live variants of live products. `query` matches the product name or a variant SKU,
    # case-insensitively; `missing_alt` keeps images whose alt text is empty. Returns [images, total];
    # each image also answers product_id, product_name and on_master.
    def images(query: nil, missing_alt: false, page: 1, per_page: 25)
      scope = base_scope
      if query.present?
        term = "%#{Spree::Image.sanitize_sql_like(query.to_s.strip.downcase)}%"
        scope = scope.where('LOWER(spree_products.name) LIKE :term OR LOWER(spree_variants.sku) LIKE :term', term: term)
      end
      scope = scope.where("spree_assets.alt IS NULL OR TRIM(spree_assets.alt) = ''") if missing_alt
      total = scope.count
      rows = scope.select('spree_assets.*, spree_variants.product_id AS product_id, ' \
                          'spree_variants.is_master AS on_master, spree_products.name AS product_name')
                  .order('spree_assets.created_at DESC, spree_assets.id DESC')
                  .offset((page - 1) * per_page).limit(per_page)
                  .with_attached_attachment
      [rows.to_a, total]
    end

    def base_scope
      Spree::Image.where(viewable_type: 'Spree::Variant')
                  .joins('INNER JOIN spree_variants ON spree_variants.id = spree_assets.viewable_id')
                  .joins('INNER JOIN spree_products ON spree_products.id = spree_variants.product_id')
                  .where(spree_variants: { deleted_at: nil }, spree_products: { deleted_at: nil })
    end
  end
end
