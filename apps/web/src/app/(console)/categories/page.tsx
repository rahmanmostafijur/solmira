'use client';

import { MAX_CATEGORY_DEPTH, type Category } from '@solmira/contracts';
import { FolderPlus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { CategoryForm } from '@/components/catalog/category-form';
import {
  buildCategoryTree,
  parentOptions,
  type CategoryNode,
} from '@/components/catalog/category-tree';
import { CATEGORY_STATUS_LABELS } from '@/components/catalog/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useCategories, useDeleteCategory, useUpdateCategory } from '@/lib/catalog-queries';

type Editing = { mode: 'create'; parentId?: string } | { mode: 'edit'; category: Category } | null;

interface RowProps {
  node: CategoryNode;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (editing: Editing) => void;
  onDelete: (category: Category) => void;
  onToggleArchive: (category: Category) => void;
}

function CategoryRow({ node, canEdit, canDelete, onEdit, onDelete, onToggleArchive }: RowProps) {
  const { category } = node;
  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-canvas/60"
        style={{ paddingLeft: `${node.depth}rem` }}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {category.name}{' '}
            <span className="font-mono text-xs font-normal text-ink-muted">/{category.slug}</span>
          </p>
          {category.description && (
            <p className="truncate text-xs text-ink-muted">{category.description}</p>
          )}
        </div>
        <Link
          href={`/products?categoryId=${category.id}`}
          className="text-xs text-ink-muted hover:text-accent hover:underline"
        >
          {category.productCount} product{category.productCount === 1 ? '' : 's'}
        </Link>
        <Badge tone={CATEGORY_STATUS_LABELS[category.status].tone}>
          {CATEGORY_STATUS_LABELS[category.status].label}
        </Badge>
        {canEdit && (
          <div className="flex gap-1">
            {node.depth < MAX_CATEGORY_DEPTH && category.status === 'ACTIVE' && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Add a subcategory to ${category.name}`}
                onClick={() => onEdit({ mode: 'create', parentId: category.id })}
              >
                <FolderPlus aria-hidden className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onEdit({ mode: 'edit', category })}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onToggleArchive(category)}>
              {category.status === 'ACTIVE' ? 'Archive' : 'Restore'}
            </Button>
            {canDelete && (
              <Button variant="ghost" size="sm" onClick={() => onDelete(category)}>
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="divide-y divide-line">
          {node.children.map((child) => (
            <CategoryRow
              key={child.category.id}
              node={child}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleArchive={onToggleArchive}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoriesView({ organizationId }: { organizationId: string }) {
  const notify = useToast();
  const { can } = usePermissions();
  const categories = useCategories(organizationId);
  const update = useUpdateCategory(organizationId);
  const remove = useDeleteCategory(organizationId);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const tree = useMemo(() => buildCategoryTree(categories.data?.items ?? []), [categories.data]);
  const canEdit = can('categories.update');

  const toggleArchive = async (category: Category) => {
    try {
      await update.mutateAsync({
        id: category.id,
        change: { status: category.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' },
      });
      notify(
        category.status === 'ACTIVE'
          ? `“${category.name}” archived`
          : `“${category.name}” restored`,
      );
    } catch (error) {
      notify(describeError(error), 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify(`“${deleting.name}” deleted`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Categories"
        description={`Group products for browsing and reporting, up to ${MAX_CATEGORY_DEPTH} levels deep.`}
        actions={
          can('categories.create') && (
            <Button onClick={() => setEditing({ mode: 'create' })}>
              <Plus aria-hidden className="size-4" /> New category
            </Button>
          )
        }
      />
      <Panel>
        {categories.isPending ? (
          <LoadingRows label="Loading categories" />
        ) : categories.isError ? (
          <div className="p-4">
            <Alert tone="error">{describeError(categories.error)}</Alert>
          </div>
        ) : tree.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Create a top-level category such as “Footwear”, then add subcategories."
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Category tree">
            {tree.map((node) => (
              <CategoryRow
                key={node.category.id}
                node={node}
                canEdit={canEdit}
                canDelete={can('categories.delete')}
                onEdit={setEditing}
                onDelete={setDeleting}
                onToggleArchive={(c) => void toggleArchive(c)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={editing !== null}
        title={editing?.mode === 'edit' ? 'Edit category' : 'New category'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <CategoryForm
            organizationId={organizationId}
            category={editing.mode === 'edit' ? editing.category : undefined}
            parentId={editing.mode === 'create' ? editing.parentId : undefined}
            parents={parentOptions(tree, editing.mode === 'edit' ? editing.category.id : undefined)}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Only empty categories can be deleted. If it still has products or subcategories, move them or archive the category instead."
        confirmLabel="Delete category"
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <RequireOrganization permission="categories.read">
      {(organization) => <CategoriesView organizationId={organization.id} />}
    </RequireOrganization>
  );
}
