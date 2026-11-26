//! Release manifest for the official Linux x86_64 kernel archives.
//!
//! The agent only installs archives it can verify, so this table is both the
//! list of versions the UI offers and the trust anchor: `package` is the zip
//! digest, `core`/`cli` are the digests of the two binaries inside it. Values
//! were measured on 2026-11-25 from the GitHub release assets (see the M3 plan).

/// Release channel a version was published on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Prerelease,
}

impl Channel {
    /// Wire name used by `/packages` and `/meta`; the web UI matches these
    /// lowercase strings, so they are part of the API, not a display choice.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Prerelease => "prerelease",
        }
    }
}

/// One official EasyTier release for Linux x86_64.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinuxPackage {
    pub version: &'static str,
    pub channel: Channel,
    /// Lowercase hex SHA-256 of `easytier-linux-x86_64-<version>.zip`.
    pub package: &'static str,
    /// Lowercase hex SHA-256 of `easytier-core` inside the zip.
    pub core: &'static str,
    /// Lowercase hex SHA-256 of `easytier-cli` inside the zip.
    pub cli: &'static str,
}

/// Official Linux x86_64 releases, newest first.
pub const LINUX_PACKAGES: &[LinuxPackage] = &[
    LinuxPackage {
        version: "v2.7.1",
        channel: Channel::Prerelease,
        package: "8dc4f8576c7a4978c1f000630014b75ec88d172f6cb10935e72092ddd5ec7a9a",
        core: "442d846bae32b644b42e69edbc15080c31ca0c5ae078e8e593d61b5ecf38114f",
        cli: "3e251c060ba574cf124b9a36caf2663a63e4ea30ba746e96aee080905a2d9c5b",
    },
    LinuxPackage {
        version: "v2.6.4",
        channel: Channel::Stable,
        package: "61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6",
        core: "35b854e0c5853c02733870488c977200f6aa06d09c08d5dc7f9f9e150e7be8d5",
        cli: "8da66644ec50dcf618fccf76780991f52dfbe2939797abc0efe0ef4d4c4d3383",
    },
    LinuxPackage {
        version: "v2.5.0",
        channel: Channel::Prerelease,
        package: "c715d62ffcdad2578bc5d743bdfbcfe02cda9c12f80bd1bad3b36d4d7fc0eb8b",
        core: "f1bd60be7a50da84f50732ed4b826b70284c84f05dadbd3fe448429dfe184322",
        cli: "e339aea31943f0c5ced2a5a6ecdd675da3bb25843cf847107744e656f8200838",
    },
    LinuxPackage {
        version: "v2.4.5",
        channel: Channel::Stable,
        package: "d33d1fe6e06fae6155ca7a6ea214657de8d29c4edd5e16fb51f128bef29d3aec",
        core: "a344b86d7acd739adc59c84d1b9b9f093ae461d28fea6c21311766e384ed5ea5",
        cli: "74507151af719d15052622429d2232b4359bf676e1cb96752364dfde4d07bd37",
    },
];

/// Version installed when the caller does not ask for a specific one.
pub const DEFAULT_VERSION: &str = "v2.6.4";

/// Looks a version up in the manifest; versions are matched verbatim (`v` prefix).
pub fn lookup(version: &str) -> Option<&'static LinuxPackage> {
    LINUX_PACKAGES.iter().find(|item| item.version == version)
}

/// Release asset name for a version, as published on GitHub.
pub fn asset_name(version: &str) -> String {
    format!("easytier-linux-x86_64-{version}.zip")
}

/// Canonical GitHub download URL for a version's release asset.
pub fn official_url(version: &str) -> String {
    format!(
        "https://github.com/EasyTier/EasyTier/releases/download/{version}/{}",
        asset_name(version)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_holds_the_four_official_versions() {
        assert_eq!(LINUX_PACKAGES.len(), 4);
        // Newest first: the UI shows the manifest in order.
        let versions: Vec<&str> = LINUX_PACKAGES.iter().map(|item| item.version).collect();
        assert_eq!(versions, ["v2.7.1", "v2.6.4", "v2.5.0", "v2.4.5"]);
        let channels: Vec<Channel> = LINUX_PACKAGES.iter().map(|item| item.channel).collect();
        assert_eq!(
            channels,
            [
                Channel::Prerelease,
                Channel::Stable,
                Channel::Prerelease,
                Channel::Stable
            ]
        );
    }

    #[test]
    fn lookup_hits_every_manifest_version() {
        for item in LINUX_PACKAGES {
            let found = lookup(item.version).expect("manifest version must be found");
            assert_eq!(found.version, item.version);
            assert_eq!(found.channel, item.channel);
            // Every digest is a 64-char lowercase hex SHA-256, so a truncated or
            // uppercased paste cannot slip through into a checksum comparison.
            for digest in [found.package, found.core, found.cli] {
                assert_eq!(digest.len(), 64, "digest length for {}", item.version);
                assert!(
                    digest
                        .chars()
                        .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
                    "digest must be lowercase hex for {}",
                    item.version
                );
            }
        }
    }

    #[test]
    fn channel_wire_names_are_lowercase() {
        assert_eq!(Channel::Stable.as_str(), "stable");
        assert_eq!(Channel::Prerelease.as_str(), "prerelease");
    }

    #[test]
    fn lookup_rejects_unknown_and_unnormalized_versions() {
        assert!(lookup("v9.9.9").is_none());
        assert!(lookup("").is_none());
        // No implicit `v` prefix normalisation: callers pass the exact tag.
        assert!(lookup("2.6.4").is_none());
    }

    #[test]
    fn stable_default_is_pinned() {
        assert_eq!(DEFAULT_VERSION, "v2.6.4");
        let item = lookup(DEFAULT_VERSION).expect("default must be installable");
        assert_eq!(item.channel, Channel::Stable);
        // The Docker image (deploy/docker/Dockerfile) bakes this same zip digest.
        assert_eq!(
            item.package,
            "61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6"
        );
    }

    #[test]
    fn asset_name_and_official_url_are_exact() {
        assert_eq!(asset_name("v2.6.4"), "easytier-linux-x86_64-v2.6.4.zip");
        assert_eq!(
            official_url("v2.6.4"),
            "https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-linux-x86_64-v2.6.4.zip"
        );
        assert_eq!(asset_name("v9.9.9"), "easytier-linux-x86_64-v9.9.9.zip");
        assert_eq!(
            official_url("v9.9.9"),
            "https://github.com/EasyTier/EasyTier/releases/download/v9.9.9/easytier-linux-x86_64-v9.9.9.zip"
        );
    }
}
