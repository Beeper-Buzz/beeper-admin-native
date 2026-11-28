import type { AdminResource, AdminTree, AdminTreeNode } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { isSpreeError } from '../src/errors';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';
import { rails, railsJson } from './rails';

/**
 * Tree views (companion gem 0.7, docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §1)
 * against the demo `taxons` tree of the Spree 4.2 store (Spree::Taxon grouped by the hidden
 * `taxonomies` type; infra/spree/4.2/initializers/admin_native_demo_inbox.rb). The test makes its
 * own taxonomies through `bin/rails runner` and deletes them afterwards. Skips without
 * `admin.resources`, without a tree-view type, or when the store can't be seeded.
 */
const TREE = 'taxons';

interface Seed {
  taxonomy: number;
  other: number;
  root: number;
  a: number;
  b: number;
  c: number;
  elsewhere: number;
}

const shape = (nodes: AdminTreeNode[]): string =>
  nodes.map((n) => (n.children.length ? `${n.title}(${shape(n.children)})` : n.title)).join(' ');

describe.runIf(enabled)(`tree views contract: Spree ${env.label}`, () => {
  let probe: StoreProbe;
  let adapter: SpreeAdapter;
  let manifest: AdminResource[] = [];
  let seed: Seed | null = null;
  let seedError = '';
  const tag = `CT${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    if (!probe.capabilities.includes('admin.resources')) return;
    const transport = baseTransport();
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(await signIn(transport)), {
      companion: probe.gem !== null,
    });
    manifest = (await adapter.resources.manifest()).types;
    if (!manifest.some((t) => t.key === TREE && t.view)) return;
    // Root > A, B, C in that order; a second taxonomy with one taxon for the group checks.
    const res = railsJson<Seed>(
      [
        `t = Spree::Taxonomy.create!(name: '${tag} Menu')`,
        `o = Spree::Taxonomy.create!(name: '${tag} Other')`,
        "a = Spree::Taxon.create!(name: 'A', parent: t.root, taxonomy: t)",
        "b = Spree::Taxon.create!(name: 'B', parent: t.root, taxonomy: t)",
        "c = Spree::Taxon.create!(name: 'C', parent: t.root, taxonomy: t)",
        "x = Spree::Taxon.create!(name: 'X', parent: o.root, taxonomy: o)",
        '[a, b, c].each_with_index { |n, i| n.update_columns(position: i) }',
        '{ taxonomy: t.id, other: o.id, root: t.root.id, a: a.id, b: b.id, c: c.id, elsewhere: x.id }',
      ].join('; '),
    );
    if ('value' in res) seed = res.value;
    else seedError = res.error;
  });

  afterAll(() => {
    if (seed) rails(`Spree::Taxonomy.where(id: [${seed.taxonomy}, ${seed.other}]).destroy_all`);
    writeResults();
  });

  const ready = (skip: (why: string) => never): Seed => {
    if (!probe.capabilities.includes('admin.resources'))
      skip('no admin.resources (needs the companion gem 0.4 with registered types)');
    if (!manifest.some((t) => t.key === TREE && t.view))
      skip(`no ${TREE} tree view on this store (the 4.2 demo types, companion gem 0.7)`);
    if (!seed) skip(`can't seed taxonomies through docker compose exec: ${seedError}`);
    return seed as Seed;
  };
  const id = String;
  const tree = (s: Seed): Promise<AdminTree> => adapter.resources.tree(TREE, id(s.taxonomy));
  const refused = async (p: Promise<unknown>) => {
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    );
    expect(isSpreeError(e)).toBe(true);
    return e as { kind: string; status: number };
  };

  proves(
    'admin.resources',
    'describes the tree view, its hidden group type and the taxon lookup',
    async (skip) => {
      ready(skip);
      const taxons = manifest.find((t) => t.key === TREE);
      expect(taxons?.view).toEqual({
        type: 'tree',
        parent: 'parent_id',
        position: 'position',
        group: 'taxonomy_id',
      });
      expect(taxons?.fields.find((f) => f.name === 'taxonomy_id')).toMatchObject({
        type: 'reference',
        resource: 'taxonomies',
      });
      expect(manifest.find((t) => t.key === 'taxonomies')?.hidden).toBe(true);
      expect(manifest.find((t) => t.key === 'spree_taxons')?.hidden).toBe(true);
      // A type without a view keeps the flat list.
      expect(manifest.find((t) => t.key === 'refund_reasons')?.view ?? null).toBeNull();
    },
  );

  proves('admin.resources', 'returns one group’s tree, nested in position order', async (skip) => {
    const s = ready(skip);
    const t = await tree(s);
    expect(t.group).toMatchObject({ id: id(s.taxonomy) });
    expect(shape(t.nodes)).toBe(`${tag} Menu(A B C)`);
    expect(t.nodes[0]?.children.map((n) => n.id)).toEqual([s.a, s.b, s.c].map(id));
  });

  proves('admin.resources', 'reorders, indents and outdents in one PATCH each', async (skip) => {
    const s = ready(skip);
    // C to the front: the others keep their order.
    let t = await adapter.resources.moveTree(TREE, id(s.taxonomy), [
      { id: id(s.c), parentId: id(s.root), position: 0 },
    ]);
    expect(shape(t.nodes)).toBe(`${tag} Menu(C A B)`);
    // Indent B under A, then send a whole sibling list as the app does.
    t = await adapter.resources.moveTree(TREE, id(s.taxonomy), [
      { id: id(s.b), parentId: id(s.a), position: 0 },
    ]);
    expect(shape(t.nodes)).toBe(`${tag} Menu(C A(B))`);
    t = await adapter.resources.moveTree(TREE, id(s.taxonomy), [
      { id: id(s.a), parentId: id(s.root), position: 0 },
      { id: id(s.b), parentId: id(s.root), position: 1 },
      { id: id(s.c), parentId: id(s.root), position: 2 },
    ]);
    expect(shape(t.nodes)).toBe(`${tag} Menu(A B C)`);
    // The store reads the same back, and Spree's nested set still agrees.
    expect(shape((await tree(s)).nodes)).toBe(`${tag} Menu(A B C)`);
    const valid = rails(`puts(Spree::Taxon.valid? ? 'CT_VALID' : 'CT_INVALID')`);
    expect(valid.out).toContain('CT_VALID');
  });

  proves('admin.resources', 'refuses cycles and nodes outside the group, changing nothing', async (skip) => {
    const s = ready(skip);
    const cycle = await refused(
      adapter.resources.moveTree(TREE, id(s.taxonomy), [{ id: id(s.root), parentId: id(s.a), position: 0 }]),
    );
    expect(cycle).toMatchObject({ kind: 'invalid', status: 422 });
    const outside = await refused(
      adapter.resources.moveTree(TREE, id(s.taxonomy), [
        { id: id(s.a), parentId: id(s.elsewhere), position: 0 },
      ]),
    );
    expect(outside).toMatchObject({ kind: 'invalid', status: 422 });
    expect(shape((await tree(s)).nodes)).toBe(`${tag} Menu(A B C)`);
    const missing = await refused(adapter.resources.tree(TREE, '999999999'));
    expect(missing).toMatchObject({ kind: 'notFound', status: 404 });
  });

  proves('admin.resources', 'creates a node in a group, which then shows in its tree', async (skip) => {
    const s = ready(skip);
    const created = await adapter.resources.create(TREE, {
      name: 'D',
      taxonomy_id: id(s.taxonomy),
      parent_id: id(s.root),
    });
    const t = await tree(s);
    expect(t.nodes[0]?.children.map((n) => n.id)).toContain(created.id);
    // Moved to the front like the app's inline add.
    const moved = await adapter.resources.moveTree(TREE, id(s.taxonomy), [
      { id: created.id, parentId: id(s.root), position: 0 },
    ]);
    expect(shape(moved.nodes)).toBe(`${tag} Menu(D A B C)`);
  });
});
