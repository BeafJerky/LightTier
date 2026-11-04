fn main() {
    match protoc_bin_vendored::protoc_bin_path() {
        Ok(p) => println!("{}", p.display()),
        Err(e) => {
            eprintln!("protoc not found: {e}");
            std::process::exit(1);
        }
    }
}
