"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Building2, Phone, Hospital, Shield, Car, ExternalLink, MapPin } from "lucide-react"
import { FadeIn, StaggerContainer, StaggerItem, GlowEffect } from "@/components/animations"
import type { LocalResourcesData } from "@/lib/get-local-resources"

interface LocalResourcesProps {
    cityName: string
    stateName: string
    landmark?: string | null
    /** Web-verified resources for this city. When null, a safe generic
     *  section renders instead of fabricated institution names. */
    resources?: LocalResourcesData | null
}

function telHref(phone?: string | null) {
    if (!phone) return undefined
    const digits = phone.replace(/[^0-9+]/g, "")
    return digits ? `tel:${digits}` : undefined
}

interface ResourceCard {
    icon: typeof Hospital
    title: string
    subtitle?: string | null
    address?: string | null
    phone?: string | null
    source_url?: string | null
    color: string
    glow: string
}

export function LocalResources({ cityName, stateName, landmark, resources }: LocalResourcesProps) {
    const cards: ResourceCard[] = []

    // Build cards ONLY from verified data. A null slot is skipped entirely so we
    // never show an unverified/guessed institution name.
    if (resources?.hospital?.name) {
        cards.push({
            icon: Hospital,
            title: resources.hospital.name,
            subtitle: "Nearest hospital / emergency room",
            address: resources.hospital.address,
            phone: resources.hospital.phone,
            source_url: resources.hospital.source_url,
            color: "text-red-500",
            glow: "rgba(239, 68, 68, 0.2)",
        })
    }
    if (resources?.police?.name) {
        cards.push({
            icon: Shield,
            title: resources.police.name,
            subtitle: "Law enforcement serving this area — request your accident report",
            address: resources.police.address,
            phone: resources.police.phone,
            source_url: resources.police.source_url,
            color: "text-blue-600",
            glow: "rgba(37, 99, 235, 0.2)",
        })
    }
    if (resources?.court?.court_name || resources?.court?.name) {
        const c = resources.court
        const title = c.court_name || c.name || "Superior Court"
        cards.push({
            icon: Building2,
            title: c.branch ? `${title} — ${c.branch}` : title,
            subtitle: c.serves_note || "Where personal injury lawsuits are filed",
            address: c.address,
            phone: c.phone,
            source_url: c.source_url,
            color: "text-purple-600",
            glow: "rgba(147, 51, 234, 0.2)",
        })
    }
    if (resources?.chp_or_dmv?.name) {
        cards.push({
            icon: Car,
            title: resources.chp_or_dmv.name,
            subtitle: "California Highway Patrol / DMV",
            address: resources.chp_or_dmv.address,
            phone: resources.chp_or_dmv.phone,
            source_url: resources.chp_or_dmv.source_url,
            color: "text-teal-600",
            glow: "rgba(45, 212, 191, 0.2)",
        })
    }

    // Emergency Services is always accurate — 911 is universal.
    cards.push({
        icon: Phone,
        title: "Emergency Services",
        subtitle: "Call 911 for immediate, life-threatening emergencies",
        phone: "911",
        color: "text-orange-500",
        glow: "rgba(249, 115, 22, 0.2)",
    })

    const hasVerified = cards.length > 1
    const gridCols = cards.length >= 4 ? "lg:grid-cols-4" : cards.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"

    return (
        <section className="py-16 px-4 bg-white">
            <div className="max-w-6xl mx-auto">
                <FadeIn direction="up" delay={0.1}>
                    <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-slate-800">
                        Local Resources in {cityName}
                    </h2>
                    <p className="text-center text-gray-600 mb-8 max-w-2xl mx-auto">
                        Essential contacts for accident victims in {cityName}, {stateName}.
                        {landmark && (
                            <span className="block mt-2 text-teal-600 font-medium">
                                Proudly serving the community near {landmark}.
                            </span>
                        )}
                    </p>
                </FadeIn>

                <StaggerContainer staggerDelay={0.08} className={`grid md:grid-cols-2 ${gridCols} gap-6`}>
                    {cards.map((resource, index) => (
                        <StaggerItem key={index}>
                            <Card className="h-full hover:shadow-lg transition-all duration-300 border-0 shadow-sm bg-gradient-to-br from-gray-50 to-white group">
                                <CardContent className="p-6 text-center flex flex-col h-full">
                                    <GlowEffect glowColor={resource.glow} className="mb-4">
                                        <div className="w-14 h-14 mx-auto rounded-full bg-gray-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                                            <resource.icon className={`h-7 w-7 ${resource.color}`} />
                                        </div>
                                    </GlowEffect>
                                    <h3 className="text-lg font-semibold mb-2 text-gray-800">{resource.title}</h3>
                                    {resource.subtitle && (
                                        <p className="text-gray-600 text-sm mb-3">{resource.subtitle}</p>
                                    )}
                                    <div className="mt-auto space-y-1.5 text-sm">
                                        {resource.address && (
                                            <p className="flex items-start justify-center gap-1.5 text-gray-500">
                                                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                                <span>{resource.address}</span>
                                            </p>
                                        )}
                                        {resource.phone && (
                                            <p>
                                                <a
                                                    href={telHref(resource.phone)}
                                                    className="inline-flex items-center gap-1.5 font-medium text-teal-700 hover:text-teal-800"
                                                >
                                                    <Phone className="h-4 w-4" />
                                                    {resource.phone}
                                                </a>
                                            </p>
                                        )}
                                        {resource.source_url && (
                                            <p>
                                                <a
                                                    href={resource.source_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer nofollow"
                                                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                                                >
                                                    Source <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </StaggerItem>
                    ))}
                </StaggerContainer>

                {!hasVerified && (
                    <FadeIn direction="up" delay={0.2}>
                        <p className="text-center text-sm text-gray-500 mt-6 max-w-2xl mx-auto">
                            After an accident, seek medical attention right away, and request a copy
                            of the police report for your records. In any emergency, call 911.
                        </p>
                    </FadeIn>
                )}
            </div>
        </section>
    )
}
