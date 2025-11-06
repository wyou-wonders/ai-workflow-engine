import {
  createIcons,
  LogIn,
  LogOut,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Paperclip,
  Save,
  Sparkles,
  Pencil,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  Loader2,
  History,
  PlusSquare,
  Download,
  Copy,
  Bookmark,
  Trash2,
  Upload,
  UserX,
  FileText,
  Plus, // --- REFACTOR HIGHLIGHT ---: UserX, FileText, Plus 아이콘 추가
} from "lucide";

export const icons = {
  LogIn,
  LogOut,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Paperclip,
  Save,
  Sparkles,
  Pencil,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  Loader2,
  History,
  PlusSquare,
  Download,
  Copy,
  Bookmark,
  Trash2,
  Upload,
  UserX,
  FileText,
  Plus, // --- REFACTOR HIGHLIGHT ---: UserX, FileText, Plus 아이콘 추가
};

export const create = () => {
  createIcons({
    icons,
    attrs: { "stroke-width": 1.5 },
  });
};
