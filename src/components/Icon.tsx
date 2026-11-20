import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleUserRound,
  Clock,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileX,
  Funnel,
  GripVertical,
  Image,
  Images,
  Info,
  LayoutGrid,
  List,
  ListFilter,
  Loader,
  Lock,
  LogOut,
  Maximize,
  MessageSquareText,
  Minimize,
  Minus,
  MoveHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Rss,
  Search,
  Send,
  Settings,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  type LucideIcon,
  Upload,
  User,
  X,
} from 'lucide-react'

/**
 * Every icon of the application, from the Lucide set. Screens ask for an icon
 * by what it means here (`trash`, `retry`), not by its Lucide name, so the
 * picture behind a meaning is changed in this one place.
 */
const ICONS = {
  search: Search,
  filter: ListFilter,
  list: List,
  grid: LayoutGrid,
  preview: Images,
  pdf: FileText,
  image: Image,
  download: Download,
  expand: Maximize,
  shrink: Minimize,
  back: ArrowLeft,
  previous: ChevronLeft,
  next: ChevronRight,
  plus: Plus,
  minus: Minus,
  fit: MoveHorizontal,
  close: X,
  upload: Upload,
  edit: Pencil,
  trash: Trash2,
  retry: RotateCw,
  check: Check,
  alert: TriangleAlert,
  clock: Clock,
  processing: Loader,
  eye: Eye,
  up: ChevronUp,
  down: ChevronDown,
  signOut: LogOut,
  sort: ChevronsUpDown,
  settings: Settings,
  cloud: CloudUpload,
  lock: Lock,
  info: Info,
  person: User,
  chat: MessageSquareText,
  send: Send,
  open: ExternalLink,
  noText: FileX,
  arrow: ArrowRight,
  order: ArrowUpDown,
  account: CircleUserRound,
  funnel: Funnel,
  tag: Tag,
  rss: Rss,
  grip: GripVertical,
  thumbUp: ThumbsUp,
  thumbDown: ThumbsDown,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

/** Decorative line icon; the text next to it carries the meaning. */
export function Icon({ name, size = 18, className }: Readonly<IconProps>) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      className={className === undefined ? 'icon' : `icon ${className}`}
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  )
}
