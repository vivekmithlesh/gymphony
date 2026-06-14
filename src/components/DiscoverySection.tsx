import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Trophy, UserCircle, Star, ArrowRight, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

const features = [
  {
    title: "A profile that sells for you",
    description: "A premium public page with your photos, classes and reviews — your mini-website that turns searches into walk-ins.",
    icon: UserCircle,
    color: "bg-purple-500/10 text-purple-600",
  },
  {
    title: "Show up where members search",
    description: "Get pinned on the city map exactly when nearby people are looking for a gym — inquiries land straight in your dashboard.",
    icon: MapPin,
    color: "bg-blue-500/10 text-blue-600",
  },
  {
    title: "Outrank your competition",
    description: "Climb the city leaderboard on reviews, retention and activity — so you're the first name new members see, not the fifth.",
    icon: Trophy,
    color: "bg-amber-500/10 text-amber-600",
  },
];

const topGyms = [
  { 
    name: "PowerHouse Gym", 
    score: 98, 
    rank: 1, 
    image: "PH",
    amenities: ["Cardio", "Free Weights", "AC", "Personal Training"],
    rating: 4.8
  },
  { 
    name: "Iron Paradise", 
    score: 95, 
    rank: 2, 
    image: "IP",
    amenities: ["Bodybuilding", "Crossfit", "Sauna", "Cafe"],
    rating: 4.7
  },
  { 
    name: "Elite Fitness", 
    score: 92, 
    rank: 3, 
    image: "EF",
    amenities: ["Yoga", "Zumba", "Swimming Pool", "Locker Room"],
    rating: 4.9
  },
];

export function DiscoverySection() {
  const [selectedGym, setSelectedGym] = useState<(typeof topGyms)[0] | null>(null);

  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <AnimatePresence>
        {selectedGym && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedGym(null)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-white/20 bg-white/40 p-0 shadow-2xl backdrop-blur-2xl dark:bg-black/40"
            >
              <div className="relative h-48 w-full bg-gradient-brand">
                <div className="absolute inset-0 bg-black/20" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedGym(null)}
                  className="absolute top-4 right-4 rounded-full bg-white/20 text-white hover:bg-white/40 backdrop-blur-md"
                >
                  <X className="h-5 w-5" />
                </Button>
                <div className="absolute -bottom-6 left-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-xl dark:bg-card">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-brand font-display text-2xl font-bold text-white">
                    {selectedGym.image}
                  </div>
                </div>
              </div>

              <div className="px-8 pt-10 pb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-2xl font-bold text-foreground">{selectedGym.name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex items-center gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${i < 4 ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                          />
                        ))}
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">{selectedGym.rating} Star Rating</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold uppercase tracking-widest text-primary">Rank #{selectedGym.rank}</span>
                  </div>
                </div>

                <div className="mt-8">
                  <h4 className="text-sm font-semibold text-foreground">Amenities</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedGym.amenities.map((amenity) => (
                      <div
                        key={amenity}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground"
                      >
                        <CheckCircle2 className="h-3 w-3 text-primary" />
                        {amenity}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-10 flex gap-4">
                  <Button className="flex-1 rounded-xl bg-primary py-6 text-white hover:bg-primary/90">
                    View Classes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedGym(null)}
                    className="flex-1 rounded-xl py-6"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Background decoration */}
      <div className="glow-orb top-1/2 -right-20 h-96 w-96 bg-primary-glow opacity-20" />
      
      <div className="container relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Left Side: Content */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-display text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              Stop paying for ads.{" "}
              <span className="text-gradient-brand bg-gradient-brand">
                Get found for free.
              </span>
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              Gymphony isn't just software — it's a marketplace. Every gym gets a profile, a map pin and a ranking that puts you in front of fitness seekers in your city, and sends new leads straight to your dashboard.
            </p>

            <div className="mt-12 space-y-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="group flex items-start gap-4 rounded-2xl border border-transparent p-4 transition-all hover:border-border hover:bg-card/50"
                >
                  <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${feature.color}`}>
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right Side: Leaderboard Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-brand opacity-10 blur-2xl" />
            
            <div className="relative rounded-3xl border border-white/20 bg-white/40 p-8 shadow-elegant backdrop-blur-xl dark:bg-black/20">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl font-bold text-foreground">Top Gyms in Aligarh</h3>
                  <p className="text-sm text-muted-foreground">Based on member rankings</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Trophy className="h-5 w-5" />
                </div>
              </div>

              <div className="space-y-4">
                {topGyms.map((gym) => (
                  <button
                    key={gym.name}
                    onClick={() => setSelectedGym(gym)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/40 bg-white/60 p-4 shadow-sm transition-all hover:scale-[1.02] hover:shadow-elegant dark:border-white/10 dark:bg-white/5 cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-white">
                        {gym.image}
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">{gym.name}</h4>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          <span>Rank #{gym.rank}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-primary">{gym.score}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-medium">Score</div>
                    </div>
                  </button>
                ))}

                {/* Your Gym Slot */}
                <div className="mt-6 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm dark:bg-white/10">
                    <UserCircle className="h-6 w-6 text-primary" />
                  </div>
                  <h4 className="font-bold text-foreground">Your Gym</h4>
                  <p className="mt-1 text-xs text-muted-foreground">You are not ranked yet in Aligarh</p>
                  
                  <Link to="/signup" className="block mt-6">
                    <Button className="w-full rounded-xl bg-primary hover:bg-primary/90 text-white shadow-glow">
                      Claim your ranking
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            {/* Floating decoration elements */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-6 -right-6 rounded-2xl bg-white p-4 shadow-elegant dark:bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium">12 New Leads Today</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
