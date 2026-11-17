import type { Category } from '~/archive/types'

/** The category shown as a coloured index tab, the way folders are marked in a registry. */
export function CategoryTab({ category }: Readonly<{ category: Category | undefined }>) {
  if (category === undefined) return null
  return (
    <span className="category-tab" style={{ '--tab': category.color } as React.CSSProperties}>
      {category.name}
    </span>
  )
}
