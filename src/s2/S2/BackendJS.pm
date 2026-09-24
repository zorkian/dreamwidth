#!/usr/bin/perl
#

package S2::BackendJS;

use strict;
use S2::Indenter;
use S2::BackendJS::Codegen;
use Scalar::Util qw(refaddr);

# $opts:
#    'docs' - set to true to produce code to register
#            layer documentation. (FIXME: Not yet implemented)
#    'propmeta' - set to true to include property metadata,
#            which is needed for property editing but is not
#            needed at runtime.
sub new {
    my ($class, $l, $layervar, $untrusted, $opts) = @_;
    my $this = {
        'layer' => $l,
        'layerid' => $layervar,
        'untrusted' => $untrusted,
        'package' => '',
        'opts' => $opts || {},        
        'scope_ids' => {},
        'next_scope_id' => 0,
    };
    bless $this, $class;
}

sub getBuiltinPackage { shift->{'package'}; }
sub setBuiltinPackage { my $t = shift; $t->{'package'} = shift; }

sub getLayerVar { shift->{'layerid'}; }
sub getLayerVar { shift->{'layerid'}; }

sub untrusted { shift->{'untrusted'}; }

sub output {
    my ($this, $o) = @_;
    my $io = new S2::Indenter $o, 4;

    $io->writeln("s2.assertABI(1);");
    $io->writeln("var $this->{layerid} = s2.makeLayer();");
    my $nodes = $this->{'layer'}->getNodes();
    foreach my $n (@$nodes) {
        $n->asJS($this, $io);
    }
#    $io->writeln("return l");
}

# S2 block scopes need distinct names in the generated JavaScript. Assign
# identifiers in output traversal order; Perl reference addresses vary by run.
sub scopeID {
    my ( $this, $scope ) = @_;
    my $address = refaddr($scope);
    return $this->{scope_ids}{$address} //= ++$this->{next_scope_id};
}

sub decorateLocal {
    my ($this, $varname, $scope) = @_;
    return "__" . $this->scopeID($scope) . "_" . $varname;
}

# To avoid conflict with JavaScript's reserved words, all
# bare identifiers must be decorated.
# Local variables should use decorateLocal (above) instead.
sub decorateIdent {
    my ($this, $varname) = @_;
    
    return "_".$varname;
}

sub quoteString {
    shift if ref $_[0];
    my $s = shift;
    return "\"" . quoteStringInner($s) . "\"";
}

sub quoteStringInner {
    my $s = shift;
    $s =~ s/([\\\"])/\\$1/g;
    $s =~ s/\n/\\n/g;
    $s =~ s/\r/\\r/g;
    $s =~ s/\t/\\t/g;
    $s =~ s/\x{2028}/\\u2028/g;
    $s =~ s/\x{2029}/\\u2029/g;
    return $s;
}

1;
