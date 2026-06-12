import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Package, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Trash2, 
  Edit2, 
  Eye, 
  EyeOff, 
  Megaphone,
  X,
  Coffee,
  Zap,
  Dumbbell,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  Upload,
  ArrowRight,
  ChevronRight,
  Camera as CameraIcon,
  RefreshCw,
  SwitchCamera,
  Loader2
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BackButton } from "./BackButton";
import { OwnerStoreOrders } from "./OwnerStoreOrders";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import { hasAccess } from "@/lib/permissions";
import { Crown, Lock } from 'lucide-react';
import { useNavigate } from "@tanstack/react-router";
import { ProtectedProRoute } from "@/components/ProtectedProRoute";
import { timeLeftLabel, isCampaignExpired } from "@/lib/campaign";

interface Product {
  id: string;
  item_name: string;
  brand?: string;
  price: number;
  stock_quantity: number;
  status: string;
  category?: string;
  show_in_app: boolean;
  image_url?: string;
  description?: string;
}

interface Campaign {
  id: string;
  name: string;
  discount_percentage: number;
  target_type: "global" | "streak";
  applies_to: string;
  is_active: boolean;
  ends_at?: string | null;
  created_at?: string;
}

export function InventoryManager() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStockStatus, setSelectedStockStatus] = useState<string>("all");
  const [priceSortOrder, setPriceSortOrder] = useState<string>("none");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [gymSettings, setGymSettings] = useState<any>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  // The gym's id (gym_settings.id) — stamped onto each product so the member
  // storefront, which queries inventory by gym_id, can find it.
  const [gymId, setGymId] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchSettings = async () => {
      if (user?.id) {
        setOwnerId(user.id);
        const { data } = await supabase.from('gym_settings').select('id, plan_type').eq('gym_owner_id', user.id).single();
        setGymSettings(data);
        setGymId(data?.id ?? null);
      }
    };
    fetchSettings();
  }, [user?.id]);

  const isPro = hasAccess(gymSettings?.plan_type, 'advanced_analytics');

  const [newProduct, setNewProduct] = useState({
    name: "",
    price: "",
    stock: "",
    category: "Supplements",
    description: "",
    brand: "",
    image_url: ""
  });

  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);
  const [stockUpdateValue, setStockUpdateValue] = useState("");

  // ── Campaigns ───────────────────────────────────────────────────────────────
  const [campaignForm, setCampaignForm] = useState<{
    name: string;
    discount: string;
    target_type: "global" | "streak";
    applies_to: string;
    duration_days: string;
  }>({
    name: "",
    discount: "",
    target_type: "global",
    applies_to: "All",
    duration_days: "",
  });
  const [isLaunchingCampaign, setIsLaunchingCampaign] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // Load this owner's campaigns so they can see and manage what they launched.
  const fetchCampaigns = useCallback(async (owner: string) => {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name, discount_percentage, target_type, applies_to, is_active, ends_at, created_at")
      .eq("gym_owner_id", owner)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Campaigns fetch error:", error.message);
      return;
    }
    setCampaigns((data as Campaign[]) || []);
  }, []);

  // How many completed orders each campaign has driven, so owners can see at a
  // glance whether a campaign is actually converting into sales.
  const [campaignOrders, setCampaignOrders] = useState<Record<string, number>>({});
  const fetchCampaignOrders = useCallback(async (owner: string) => {
    const { data, error } = await supabase
      .from("purchases")
      .select("campaign_id")
      .eq("gym_owner_id", owner)
      .eq("status", "completed")
      .not("campaign_id", "is", null);
    if (error) {
      console.warn("Campaign orders fetch error:", error.message);
      return;
    }
    const counts: Record<string, number> = {};
    (data || []).forEach((r: any) => {
      if (r.campaign_id) counts[r.campaign_id] = (counts[r.campaign_id] || 0) + 1;
    });
    setCampaignOrders(counts);
  }, []);

  const handleToggleCampaign = async (id: string, isActive: boolean) => {
    const willBeActive = !isActive;
    const camp = campaigns.find((c) => c.id === id);
    // Resuming an already-ended campaign: clear its past end date so it actually
    // goes live again (otherwise lazy expiry would keep hiding it from members).
    const clearEnd = willBeActive && camp ? isCampaignExpired(camp.ends_at) : false;
    const updates: { is_active: boolean; ends_at?: null } = { is_active: willBeActive };
    if (clearEnd) updates.ends_at = null;

    try {
      let query = supabase.from("campaigns").update(updates).eq("id", id);
      if (ownerId) query = query.eq("gym_owner_id", ownerId);
      const { error } = await query;
      if (error) throw error;
      setCampaigns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, is_active: willBeActive, ...(clearEnd ? { ends_at: null } : {}) } : c))
      );
      toast.success(
        !willBeActive
          ? "Campaign paused — hidden from members."
          : clearEnd
            ? "Campaign resumed with no end date — live for members."
            : "Campaign resumed — live for members."
      );
    } catch (error: any) {
      toast.error(`Could not update campaign: ${error.message || "Unknown error"}`);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    try {
      let query = supabase.from("campaigns").delete().eq("id", id);
      if (ownerId) query = query.eq("gym_owner_id", ownerId);
      const { error } = await query;
      if (error) throw error;
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
      toast.success("Campaign deleted.");
    } catch (error: any) {
      toast.error(`Could not delete campaign: ${error.message || "Unknown error"}`);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!campaignForm.name.trim()) {
      toast.error("Give your campaign a name.");
      return;
    }
    const discountNum = Number(campaignForm.discount);
    if (!Number.isFinite(discountNum) || discountNum <= 0 || discountNum > 100) {
      toast.error("Enter a discount between 1 and 100%.");
      return;
    }

    // Optional duration: blank = runs until manually ended; otherwise auto-ends
    // N days from now.
    let endsAt: string | null = null;
    if (campaignForm.duration_days.trim() !== "") {
      const days = Number(campaignForm.duration_days);
      if (!Number.isFinite(days) || days <= 0) {
        toast.error("Duration must be a positive number of days (or leave it blank).");
        return;
      }
      endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      setIsLaunchingCampaign(true);
      // user comes from useAuth (component scope)
      if (!user) {
        toast.error("Please sign in again to launch a campaign.");
        return;
      }

      const { error } = await supabase.from("campaigns").insert([{
        name: campaignForm.name.trim(),
        discount_percentage: discountNum,
        target_type: campaignForm.target_type, // 'global' | 'streak'
        applies_to: campaignForm.applies_to,     // 'All' | category name
        is_active: true,
        ends_at: endsAt,
        gym_owner_id: user.id,
      }]);

      if (error) throw error;

      toast.success("🚀 Campaign launched to the Member App!");
      setIsCampaignModalOpen(false);
      setCampaignForm({ name: "", discount: "", target_type: "global", applies_to: "All", duration_days: "" });
      if (ownerId) fetchCampaigns(ownerId);
    } catch (error: any) {
      console.error("Launch campaign error:", error);
      const hint = error.message?.toLowerCase().includes("does not exist")
        ? "The 'campaigns' table is missing — run the provisioning SQL."
        : error.message;
      toast.error(`Could not launch campaign: ${hint || "Unknown error"}`);
    } finally {
      setIsLaunchingCampaign(false);
    }
  };

  // Fetch this owner's inventory. Scoped by gym_owner_id for hard multi-tenant
  // isolation (RLS also enforces it). Errors are surfaced — silently swallowing
  // them is exactly why the grid showed "No products found" with no clue why.
  const fetchInventory = useCallback(async (owner: string, opts?: { silent?: boolean }) => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .eq("gym_owner_id", owner)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Inventory fetch error:", error.message);
        if (!opts?.silent) {
          const hint = error.message.toLowerCase().includes("does not exist")
            ? "The 'inventory' table is missing — run the provisioning SQL."
            : error.message;
          toast.error(`Could not load inventory: ${hint}`);
        }
        setProducts([]);
        return;
      }

      const mappedProducts = (data || []).map(item => ({
        ...item,
        status: item.stock_quantity > 10 ? "In Stock" : (item.stock_quantity > 0 ? "Low Stock" : "Out of Stock")
      }));

      setProducts(mappedProducts);
    } catch (error: any) {
      console.warn("Fetch error in fetchInventory:", error);
      if (!opts?.silent) toast.error(`Could not load inventory: ${error.message || "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load + subscribe to realtime once we know the Pro owner. The grid updates
  // live on any insert/update/delete to THIS gym's inventory.
  useEffect(() => {
    if (!gymSettings) return;
    if (!isPro || !ownerId) {
      setIsLoading(false);
      return;
    }

    fetchInventory(ownerId);
    fetchCampaigns(ownerId);
    fetchCampaignOrders(ownerId);

    const channel = supabase
      .channel("inventory_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory", filter: `gym_owner_id=eq.${ownerId}` },
        () => fetchInventory(ownerId, { silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns", filter: `gym_owner_id=eq.${ownerId}` },
        () => fetchCampaigns(ownerId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchases", filter: `gym_owner_id=eq.${ownerId}` },
        () => fetchCampaignOrders(ownerId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gymSettings, isPro, ownerId, fetchInventory, fetchCampaigns, fetchCampaignOrders]);

  const handleImageUpload = async (file: File | Blob) => {
    try {
      // Validate before doing any work.
      const contentType = file instanceof File ? file.type : "image/jpeg";
      if (file instanceof File && !contentType.startsWith("image/")) {
        toast.error("Please choose an image file.");
        return null;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image is larger than 5 MB. Please pick a smaller file.");
        return null;
      }

      setUploadingImage(true);
      // user comes from useAuth (component scope)
      if (!user) {
        toast.error("Please sign in to upload images.");
        return null;
      }

      // Collision-safe path: owner folder + timestamp + short random + clean ext.
      const rawExt = file instanceof File ? file.name.split(".").pop() ?? "jpg" : "jpg";
      const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("inventory-items")
        .upload(filePath, file, { upsert: true, contentType });

      if (uploadError) {
        const msg = uploadError.message.toLowerCase().includes("not found") || uploadError.message.toLowerCase().includes("bucket")
          ? "Storage bucket 'inventory-items' is missing or inaccessible. Create it in Supabase Storage (see provisioning SQL)."
          : uploadError.message;
        toast.error(`Image upload failed: ${msg}`);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("inventory-items")
        .getPublicUrl(filePath);

      setNewProduct((prev) => ({ ...prev, image_url: publicUrl }));
      toast.success("Image uploaded successfully!");
      return publicUrl;
    } catch (error: any) {
      console.warn("Error uploading image:", error);
      toast.error(`Image upload failed: ${error.message || "Unknown error"}`);
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const startCamera = async (currentFacingMode = facingMode) => {
    // Check if navigator.mediaDevices is available (required for camera access)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("Camera API not supported in this browser");
      // toast.error("Camera access is not supported by your browser. Please ensure you are using HTTPS and an updated browser.");
      return;
    }

    try {
      console.log(`Attempting to access camera with facingMode: ${currentFacingMode}...`);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: currentFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      console.log("Camera stream obtained successfully:", stream.id);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Ensure video plays after setting srcObject
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(e => console.warn("Error playing video:", e));
        };
        setIsCameraActive(true);
      }
    } catch (err: any) {
      console.warn("FULL CAMERA ERROR:", err);
      
      let errorMsg = "Could not access camera.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = "Camera permission denied. Please allow access in your browser settings.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = "No camera hardware found on this device.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = "Camera is currently in use by another application. Please close other apps and try again.";
      }
      
      // toast.error(errorMsg);
    }
  };

  const toggleCamera = () => {
    const nextFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacingMode);
    stopCamera();
    setTimeout(() => startCamera(nextFacingMode), 100);
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (blob) {
            await handleImageUpload(blob);
            stopCamera();
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  const handleAddProduct = async () => {
    if (!newProduct.name.trim() || !newProduct.price || !newProduct.stock) {
      toast.error("Please fill in name, price and stock.");
      return;
    }

    const priceNum = Number(newProduct.price);
    const stockNum = Number(newProduct.stock);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid, non-negative price.");
      return;
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      toast.error("Enter a valid, non-negative stock quantity.");
      return;
    }

    try {
      setIsSavingProduct(true);

      // user comes from useAuth (component scope)
      if (!user) {
        toast.error("Please sign in again to add products.");
        return;
      }

      const { error } = await supabase
        .from("inventory")
        .insert([{
          item_name: newProduct.name.trim(),
          price: priceNum,
          stock_quantity: stockNum,
          category: newProduct.category,
          show_in_app: true,
          description: newProduct.description,
          brand: newProduct.brand,
          image_url: newProduct.image_url || null,
          gym_owner_id: user.id,
          gym_id: gymId, // lets the member storefront find this product
        }]);

      if (error) throw error;

      toast.success("✅ Product added to inventory!");
      setIsAddModalOpen(false);
      setNewProduct({ name: "", price: "", stock: "", category: "Supplements", description: "", brand: "", image_url: "" });
      fetchInventory(user.id);
    } catch (error: any) {
      console.error("Error adding product:", error);
      toast.error(`Failed to add product: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleUpdateStock = async () => {
    if (!selectedProduct || !stockUpdateValue) return;

    try {
      setIsUpdatingStock(true);
      const newStock = selectedProduct.stock_quantity + Number(stockUpdateValue);
      
      let updateQuery = supabase
        .from("inventory")
        .update({ stock_quantity: newStock })
        .eq("id", selectedProduct.id);
      if (ownerId) updateQuery = updateQuery.eq("gym_owner_id", ownerId);
      const { error } = await updateQuery;

      if (error) throw error;

      toast.success(`Stock updated to ${newStock} units!`);
      setSelectedProduct({ ...selectedProduct, stock_quantity: newStock });
      setStockUpdateValue("");
      if (ownerId) fetchInventory(ownerId, { silent: true });
    } catch (error: any) {
      console.warn("Failed to update stock:", error);
    } finally {
      setIsUpdatingStock(false);
    }
  };

  const toggleAppVisibility = async (id: string, currentVisibility: boolean) => {
    try {
      let query = supabase
        .from("inventory")
        .update({ show_in_app: !currentVisibility })
        .eq("id", id);
      if (ownerId) query = query.eq("gym_owner_id", ownerId);
      const { error } = await query;

      if (error) throw error;

      setProducts(products.map(p =>
        p.id === id ? { ...p, show_in_app: !currentVisibility } : p
      ));
      toast.info(currentVisibility ? "Hidden from Member App" : "Now visible in Member App");
    } catch (error: any) {
      console.warn("Failed to update visibility:", error);
      toast.error(`Could not update visibility: ${error.message || "Unknown error"}`);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      let query = supabase
        .from("inventory")
        .delete()
        .eq("id", id);
      if (ownerId) query = query.eq("gym_owner_id", ownerId);
      const { error } = await query;

      if (error) throw error;

      setProducts(products.filter(p => p.id !== id));
      toast.success("Product deleted");
    } catch (error: any) {
      console.warn("Failed to delete product:", error);
      toast.error(`Could not delete product: ${error.message || "Unknown error"}`);
    }
  };

  const filteredProducts = products
    .filter(p => {
      const matchesSearch = p.item_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.category?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = selectedCategory === "all" || p.category === selectedCategory;
      
      const matchesStockStatus = selectedStockStatus === "all" || p.status === selectedStockStatus;
      
      return matchesSearch && matchesCategory && matchesStockStatus;
    })
    .sort((a, b) => {
      if (priceSortOrder === "low-to-high") {
        return a.price - b.price;
      } else if (priceSortOrder === "high-to-low") {
        return b.price - a.price;
      }
      return 0;
    });

  return (
    <ProtectedProRoute 
      featureName="Advanced Inventory" 
      description="Upgrade to Pro to manage gym stock, track supplements sales, and monitor low inventory levels in real-time."
    >
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div className="mb-2">
          <BackButton />
        </div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-3xl font-bold md:text-4xl">
              Inventory <span className="text-gradient-brand">Manager</span>
            </h1>
            <p className="mt-1 text-muted-foreground">
              Manage your gym store products and streak campaigns.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              onClick={() => setIsCampaignModalOpen(true)}
              variant="outline"
              className="h-12 px-6 rounded-xl border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 font-bold transition-all"
            >
              <Megaphone className="mr-2 h-5 w-5" />
              Launch Campaign
            </Button>
            <Button 
              onClick={() => setIsAddModalOpen(true)}
              className="h-12 px-6 rounded-xl bg-gradient-brand text-primary-foreground font-bold shadow-glow hover:shadow-primary/40 transition-all"
            >
              <Plus className="mr-2 h-5 w-5" />
              Add New Product
            </Button>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by name or category..." 
              className="pl-10 h-12 bg-white/5 border-white/10 rounded-xl focus:ring-primary/20"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-12 rounded-xl border-white/10 bg-white/5 gap-2 px-6">
                <Filter className="h-4 w-4" />
                Filters
                {(selectedCategory !== "all" || selectedStockStatus !== "all" || priceSortOrder !== "none") && (
                  <Badge className="ml-1 h-5 w-5 p-0 flex items-center justify-center bg-primary text-white rounded-full text-[10px]">
                    {[selectedCategory !== "all", selectedStockStatus !== "all", priceSortOrder !== "none"].filter(Boolean).length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-slate-900 border-white/10 text-white" align="end">
              {products.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground italic">
                  Add items first to use filters.
                </div>
              ) : (
                <>
                  <DropdownMenuLabel className="text-xs uppercase tracking-widest opacity-50">Category</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSelectedCategory("all")} className={selectedCategory === "all" ? "bg-white/10" : ""}>
                    All Categories
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedCategory("Supplements")} className={selectedCategory === "Supplements" ? "bg-white/10" : ""}>
                    Supplements
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedCategory("Drinks")} className={selectedCategory === "Drinks" ? "bg-white/10" : ""}>
                    Drinks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedCategory("Gear")} className={selectedCategory === "Gear" ? "bg-white/10" : ""}>
                    Gear
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator className="bg-white/10" />
                  
                  <DropdownMenuLabel className="text-xs uppercase tracking-widest opacity-50">Stock Status</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSelectedStockStatus("all")} className={selectedStockStatus === "all" ? "bg-white/10" : ""}>
                    All Statuses
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStockStatus("In Stock")} className={selectedStockStatus === "In Stock" ? "bg-white/10" : ""}>
                    In Stock
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStockStatus("Low Stock")} className={selectedStockStatus === "Low Stock" ? "bg-white/10" : ""}>
                    Low Stock
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStockStatus("Out of Stock")} className={selectedStockStatus === "Out of Stock" ? "bg-white/10" : ""}>
                    Out of Stock
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator className="bg-white/10" />
                  
                  <DropdownMenuLabel className="text-xs uppercase tracking-widest opacity-50">Price Range</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setPriceSortOrder("low-to-high")} className={priceSortOrder === "low-to-high" ? "bg-white/10" : ""}>
                    Low to High
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPriceSortOrder("high-to-low")} className={priceSortOrder === "high-to-low" ? "bg-white/10" : ""}>
                    High to Low
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator className="bg-white/10" />
                  
                  <DropdownMenuItem 
                    onClick={() => {
                      setSelectedCategory("all");
                      setSelectedStockStatus("all");
                      setPriceSortOrder("none");
                    }}
                    className="text-red-400 focus:text-red-400"
                  >
                    Clear Filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Active Campaigns — view / pause / delete what you launched */}
        {campaigns.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Campaigns ({campaigns.filter((c) => c.is_active).length} live)
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 max-h-96 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition-all ${
                    c.is_active
                      ? "border-primary/20 bg-primary/5"
                      : "border-slate-200 bg-slate-50 opacity-70"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{c.target_type === "streak" ? "🔥" : "🌍"}</span>
                      <p className="truncate font-bold text-slate-900">{c.name}</p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          (campaignOrders[c.id] || 0) > 0
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-400"
                        }`}
                        title="Completed orders driven by this campaign"
                      >
                        {campaignOrders[c.id] || 0} {(campaignOrders[c.id] || 0) === 1 ? "order" : "orders"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-bold text-primary">{c.discount_percentage}% off</span>
                      {" · "}
                      {c.applies_to === "All" ? "Entire store" : c.applies_to}
                      {" · "}
                      {c.target_type === "streak" ? "30+ day streak" : "Everyone"}
                      {isCampaignExpired(c.ends_at) ? (
                        <span className="font-semibold text-red-500"> · Ended</span>
                      ) : !c.is_active ? (
                        " · Paused"
                      ) : c.ends_at ? (
                        <span className="font-semibold text-amber-600"> · {timeLeftLabel(c.ends_at)}</span>
                      ) : (
                        " · No end date"
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleCampaign(c.id, c.is_active)}
                      className="h-9 rounded-lg px-3 text-xs font-bold"
                      title={c.is_active ? "Pause campaign" : "Resume campaign"}
                    >
                      {c.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCampaign(c.id)}
                      className="h-9 rounded-lg px-3 text-xs font-bold text-red-500 hover:bg-red-50 hover:text-red-600"
                      title="Delete campaign"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Store Orders — who bought your products + which campaign drove the sale */}
        <OwnerStoreOrders ownerId={ownerId} />

        {/* Inventory Grid */}
        <div className="relative">
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6`}>
            {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-3xl border border-white/10 bg-white/5 h-80 animate-pulse" />
            ))
          ) : filteredProducts.length === 0 ? (
            <div className="col-span-full py-20 text-center text-muted-foreground italic">
              No products found.
            </div>
          ) : filteredProducts.map((product) => (
          <motion.div
            key={product.id}
            layoutId={product.id}
            onClick={() => setSelectedProduct(product)}
            className="group relative rounded-[2.5rem] border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden shadow-2xl hover:shadow-primary/20 transition-all cursor-pointer"
          >
            {/* Image Container */}
            <div className="aspect-square relative overflow-hidden bg-white/5">
              {product.image_url ? (
                <img 
                  src={product.image_url} 
                  alt={product.item_name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-400 group-hover:scale-110 transition-transform duration-500">
                  {product.category === "Supplements" ? <Zap className="h-20 w-20 opacity-20" /> : 
                   product.category === "Drinks" ? <Coffee className="h-20 w-20 opacity-20" /> :
                   <Dumbbell className="h-20 w-20 opacity-20" />}
                  <span className="text-[10px] font-bold uppercase tracking-widest mt-2 opacity-40">Gym {product.category}</span>
                </div>
              )}
              
              {/* Status Tag */}
              <div className="absolute top-4 right-4">
                <Badge className={`rounded-full px-3 py-1 border-none font-bold text-[10px] shadow-lg ${
                  product.status === 'In Stock' ? 'bg-green-500 text-white' : 
                  product.status === 'Low Stock' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  {product.status}
                </Badge>
              </div>

              {/* Quick Actions Overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <Button variant="secondary" size="sm" className="rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20">
                  <Eye className="h-4 w-4 mr-2" />
                  Details
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground font-medium">{product.stock_quantity} units</div>
              </div>
              
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-bold text-white truncate group-hover:text-primary transition-colors">
                  {product.item_name}
                </h3>
                {product.category && (
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-white/5 px-2 py-1 rounded-lg">
                    {product.category}
                  </span>
                )}
              </div>
              
              <div className="flex items-center justify-between items-baseline pt-2">
                <div className="text-2xl font-black text-primary">₹{product.price.toLocaleString()}</div>
                <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-all" onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteProduct(product.id);
                }}>
                  <Trash2 className="h-5 w-5" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
        </div>
      </div>

      {/* Product Details Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
            onClick={() => setSelectedProduct(null)}
          >
            <motion.div
              layoutId={selectedProduct.id}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl bg-slate-900 rounded-[3rem] overflow-hidden shadow-2xl border border-white/10 flex flex-col md:flex-row h-full max-h-[85vh]"
            >
              {/* Image Section */}
              <div className="w-full md:w-1/2 relative bg-white/5 flex items-center justify-center">
                {selectedProduct.image_url ? (
                  <img 
                    src={selectedProduct.image_url} 
                    alt={selectedProduct.item_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-9xl opacity-20"><Package className="h-40 w-40" /></div>
                )}
                <button 
                  onClick={() => setSelectedProduct(null)}
                  className="absolute top-6 left-6 h-12 w-12 rounded-2xl bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition-all"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Details Section */}
              <div className="w-full md:w-1/2 p-10 overflow-y-auto space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    {selectedProduct.brand && (
                      <span className="text-muted-foreground font-bold text-sm uppercase tracking-tighter">
                        Brand: {selectedProduct.brand}
                      </span>
                    )}
                    {selectedProduct.category && (
                      <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/5 text-primary text-[10px] font-bold">
                        {selectedProduct.category}
                      </Badge>
                    )}
                  </div>
                  
                  <h2 className="text-4xl font-black text-white leading-tight">{selectedProduct.item_name}</h2>
                  
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-primary">₹{selectedProduct.price.toLocaleString()}</span>
                    <span className="text-muted-foreground line-through text-lg opacity-50">₹{(selectedProduct.price * 1.2).toFixed(0)}</span>
                  </div>
                </div>

                <div className="space-y-4 p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Current Stock</div>
                        <div className="text-lg font-black text-white">{selectedProduct.stock_quantity} Units</div>
                      </div>
                    </div>
                    <Badge className={`rounded-full px-4 py-1 border-none font-bold text-xs ${
                      selectedProduct.status === 'In Stock' ? 'bg-green-500 text-white' : 
                      selectedProduct.status === 'Low Stock' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                    }`}>
                      {selectedProduct.status}
                    </Badge>
                  </div>

                  {/* Stock Update Section */}
                  <div className="pt-4 flex gap-3">
                    <Input 
                      type="number"
                      placeholder="Add stock amount..."
                      value={stockUpdateValue}
                      onChange={(e) => setStockUpdateValue(e.target.value)}
                      className="bg-white/5 border-white/10 text-white h-12 rounded-xl focus:ring-primary/20"
                    />
                    <Button 
                      disabled={isUpdatingStock || !stockUpdateValue}
                      onClick={handleUpdateStock}
                      className="h-12 px-6 rounded-xl bg-primary text-white font-bold hover:shadow-glow transition-all"
                    >
                      {isUpdatingStock ? "Updating..." : "Update Stock"}
                    </Button>
                  </div>
                </div>

                {selectedProduct.description && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-white uppercase tracking-widest">Product Description</h4>
                    <p className="text-muted-foreground leading-relaxed">
                      {selectedProduct.description}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-4">
                  <button 
                    onClick={() => toggleAppVisibility(selectedProduct.id, selectedProduct.show_in_app)}
                    className={`flex-1 flex items-center justify-center gap-3 h-14 rounded-2xl transition-all border font-bold ${
                      selectedProduct.show_in_app 
                        ? 'border-green-500/20 bg-green-500/10 text-green-400' 
                        : 'border-white/10 bg-white/5 text-muted-foreground'
                    }`}
                  >
                    {selectedProduct.show_in_app ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                    {selectedProduct.show_in_app ? 'Visible in App' : 'Hidden from App'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Product Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div 
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              stopCamera();
              setIsAddModalOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white rounded-2xl md:rounded-[3rem] overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 md:p-10 space-y-6 md:space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 md:gap-4 text-slate-900">
                    <div className="h-10 w-10 md:h-12 md:w-12 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                      <Plus className="h-5 w-5 md:h-6 md:w-6" />
                    </div>
                    <h3 className="text-2xl md:text-3xl font-black">Add New Product</h3>
                  </div>
                  <button onClick={() => {
                    stopCamera();
                    setIsAddModalOpen(false);
                  }} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left Column: Image Upload & Camera */}
                  <div className="space-y-4">
                    <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Product Image</Label>
                    <div className="relative aspect-square rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden group hover:border-primary/50 transition-all">
                      {isCameraActive ? (
                        <div className="absolute inset-0 bg-black">
                          <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-2 px-4 flex-wrap">
                            <Button 
                              onClick={stopCamera} 
                              variant="secondary"
                              className="rounded-full bg-white/20 backdrop-blur-md text-white border-white/20 hover:bg-white/30 px-3 h-10"
                            >
                              <X className="h-4 w-4 mr-2" /> Cancel
                            </Button>
                            <Button 
                              onClick={toggleCamera} 
                              variant="secondary"
                              className="rounded-full bg-white/20 backdrop-blur-md text-white border-white/20 hover:bg-white/30 px-3 h-10"
                            >
                              <SwitchCamera className="h-4 w-4 mr-2" /> Switch
                            </Button>
                            <Button 
                              onClick={() => {
                                stopCamera();
                                setTimeout(() => startCamera(facingMode), 100);
                              }} 
                              variant="secondary"
                              className="rounded-full bg-white/20 backdrop-blur-md text-white border-white/20 hover:bg-white/30 px-3 h-10"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" /> Retry
                            </Button>
                            <Button 
                              onClick={capturePhoto}
                              className="rounded-full bg-primary text-white shadow-lg hover:shadow-primary/40 px-4 h-10 font-bold"
                            >
                              <CameraIcon className="h-4 w-4 mr-2" /> Capture
                            </Button>
                          </div>
                        </div>
                      ) : newProduct.image_url ? (
                        <div className="relative w-full h-full">
                          <img src={newProduct.image_url} alt="Preview" className="w-full h-full object-cover" />
                          <button 
                            onClick={() => setNewProduct({...newProduct, image_url: ""})}
                            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-all"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                          {uploadingImage ? (
                            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <Upload className="h-10 w-10 opacity-50" />
                              <p className="text-xs font-bold uppercase tracking-tighter">Upload or Capture</p>
                            </>
                          )}
                        </div>
                      )}
                      
                      {!isCameraActive && !newProduct.image_url && (
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          disabled={uploadingImage}
                        />
                      )}
                      <canvas ref={canvasRef} className="hidden" />
                    </div>

                    {!isCameraActive && !newProduct.image_url && (
                        <div className="flex gap-2">
                          <Button 
                            onClick={() => startCamera(facingMode)} 
                            variant="outline" 
                            className="flex-1 h-12 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 gap-2 font-bold"
                          >
                            <CameraIcon className="h-4 w-4" />
                            Take Live Photo
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Details */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Product Info</Label>
                      <Input 
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                        placeholder="Product Name" 
                        className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl font-bold" 
                      />
                      <Input 
                        value={newProduct.brand}
                        onChange={(e) => setNewProduct({...newProduct, brand: e.target.value})}
                        placeholder="Brand Name (e.g. MuscleBlaze)" 
                        className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl" 
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Category</Label>
                      <Select 
                        value={newProduct.category}
                        onValueChange={(value) => setNewProduct({...newProduct, category: value})}
                      >
                        <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl">
                          <SelectValue placeholder="Select Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Supplements">Supplements</SelectItem>
                          <SelectItem value="Drinks">Drinks</SelectItem>
                          <SelectItem value="Gear">Gear</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Price (₹)</Label>
                        <Input 
                          type="number"
                          value={newProduct.price}
                          onChange={(e) => setNewProduct({...newProduct, price: e.target.value})}
                          placeholder="Price" 
                          className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl font-black text-primary" 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Stock</Label>
                        <Input 
                          type="number"
                          value={newProduct.stock}
                          onChange={(e) => setNewProduct({...newProduct, stock: e.target.value})}
                          placeholder="Units" 
                          className="bg-slate-50 border-slate-200 text-slate-900 h-12 rounded-xl" 
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">Description</Label>
                      <Textarea 
                        value={newProduct.description}
                        onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
                        placeholder="Describe your product..."
                        className="bg-slate-50 border-slate-200 text-slate-900 h-32 rounded-2xl resize-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 pt-4">
                  <Button onClick={() => {
                    stopCamera();
                    setIsAddModalOpen(false);
                  }} variant="ghost" className="sm:flex-1 h-12 md:h-14 rounded-xl md:rounded-2xl text-slate-400 font-bold order-2 sm:order-1">
                    Discard
                  </Button>
                  <Button 
                    onClick={handleAddProduct}
                    disabled={isSavingProduct}
                    className="sm:flex-[2] h-12 md:h-14 rounded-xl md:rounded-2xl bg-primary text-white font-black shadow-glow hover:shadow-primary/40 transition-all text-base md:text-lg order-1 sm:order-2"
                  >
                    {isSavingProduct ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Adding...
                      </>
                    ) : "Add Product"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Campaign Modal */}
      <AnimatePresence>
        {isCampaignModalOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsCampaignModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-slate-900 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-white">
                    <Megaphone className="h-6 w-6 text-primary" />
                    <h3 className="text-2xl font-bold">Launch Campaign</h3>
                  </div>
                  <button onClick={() => setIsCampaignModalOpen(false)} className="text-white/40 hover:text-white">
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-primary mt-1 shrink-0" />
                  <p className="text-sm text-white/80 leading-relaxed">
                    {campaignForm.target_type === "streak"
                      ? "Reward members with a 30+ day attendance streak. The discount unlocks automatically in their App Store."
                      : "Run a store-wide sale (e.g. Diwali) for every member. This shows up in the Member App Store."}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white/60 font-medium">Campaign Name</Label>
                    <Input
                      value={campaignForm.name}
                      onChange={(e) => setCampaignForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Diwali Sale / 30-Day Streak Bonus"
                      className="bg-white/5 border-white/10 text-white h-12 rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/60 font-medium">Target Audience</Label>
                    <Select
                      value={campaignForm.target_type}
                      onValueChange={(value) =>
                        setCampaignForm((p) => ({ ...p, target_type: value as "global" | "streak" }))
                      }
                    >
                      <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-white/10 text-white">
                        <SelectItem value="global">🌍 Global Sale (everyone)</SelectItem>
                        <SelectItem value="streak">🔥 Streak Achievers (30+ Days)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-white/60 font-medium">Discount (%)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={campaignForm.discount}
                        onChange={(e) => setCampaignForm((p) => ({ ...p, discount: e.target.value }))}
                        placeholder="20"
                        className="bg-white/5 border-white/10 text-white h-12 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-white/60 font-medium">Applies to</Label>
                      <Select
                        value={campaignForm.applies_to}
                        onValueChange={(value) => setCampaignForm((p) => ({ ...p, applies_to: value }))}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-white/10 text-white">
                          <SelectItem value="All">Entire Store</SelectItem>
                          <SelectItem value="Supplements">All Supplements</SelectItem>
                          <SelectItem value="Drinks">All Drinks</SelectItem>
                          <SelectItem value="Gear">All Gear</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white/60 font-medium">Ends after (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={campaignForm.duration_days}
                      onChange={(e) => setCampaignForm((p) => ({ ...p, duration_days: e.target.value }))}
                      placeholder="e.g. 7 — leave blank to end it manually"
                      className="bg-white/5 border-white/10 text-white h-12 rounded-xl"
                    />
                    <p className="text-[11px] text-white/40">
                      Members see a live countdown. Blank = runs until you pause or delete it.
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleLaunchCampaign}
                  disabled={isLaunchingCampaign}
                  className="w-full h-14 rounded-2xl bg-gradient-brand text-white font-bold shadow-glow hover:shadow-primary/40 transition-all mt-4 disabled:opacity-60"
                >
                  {isLaunchingCampaign ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Launching…
                    </>
                  ) : (
                    "Blast to Member App"
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
    </ProtectedProRoute>
  );
}
