module SpreeAdminNative
  # Variants a merchant should restock: sellable (option variants, or the master of a product
  # without options), tracked, on live products, with stock summed across locations at or under
  # the threshold. The Home summary counts them and GET low_stock lists their products, so the
  # number and the list agree.
  module LowStock
    module_function

    def threshold
      SpreeAdminNative.config.low_stock_threshold
    end

    # variant_id → on-hand total, for low variants only.
    def variants(at: threshold)
      return Spree::StockItem.none unless Spree::Config[:track_inventory_levels]

      now = Time.current
      scope = Spree::StockItem.joins(variant: :product)
                              .where(spree_stock_items: { deleted_at: nil })
                              .where(spree_variants: { deleted_at: nil, track_inventory: true })
                              .where(spree_products: { deleted_at: nil })
                              .where('spree_products.discontinue_on IS NULL OR spree_products.discontinue_on > ?', now)
      if Spree::Variant.column_names.include?('discontinue_on')
        scope = scope.where('spree_variants.discontinue_on IS NULL OR spree_variants.discontinue_on > ?', now)
      end
      scope = scope.merge(Spree::Variant.eligible) if Spree::Variant.respond_to?(:eligible)
      scope.group('spree_stock_items.variant_id')
           .having('SUM(spree_stock_items.count_on_hand) <= ?', at)
           .select('spree_stock_items.variant_id AS variant_id, SUM(spree_stock_items.count_on_hand) AS on_hand')
    end

    def variant_count
      Spree::StockItem.unscoped.from(variants, :low).count
    end

    # [{ product_id:, low_variants:, lowest_on_hand: }], lowest stock first, and the product total.
    def products(page: 1, per_page: 25)
      grouped = Spree::Variant.unscoped
                              .joins("INNER JOIN (#{variants.to_sql}) low ON low.variant_id = spree_variants.id")
                              .group('spree_variants.product_id')
      total = grouped.count.size
      rows = grouped.order(Arel.sql('MIN(low.on_hand) ASC, spree_variants.product_id ASC'))
                    .offset((page - 1) * per_page).limit(per_page)
                    .pluck(Arel.sql('spree_variants.product_id, COUNT(*), MIN(low.on_hand)'))
      [rows.map { |id, count, lowest| { product_id: id.to_s, low_variants: count, lowest_on_hand: lowest.to_i } }, total]
    end
  end
end
